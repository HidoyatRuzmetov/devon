import type { Bot } from 'grammy'
import type { MessageEntity, User } from 'grammy/types'
import { withTimeout } from '../../lib/resilience/timeout.js'
import { isMaintenanceActive } from '../notifications/repo.js'
import {
  claimGroupMention,
  connectedMentionGroup,
  finishGroupMention,
  mentionCandidateIds,
  rememberGroupMember,
} from './group-mentions-repo.js'
import { sendMentionMessage } from './transport.js'

/** Match only a standalone, intentional token, never email, a username prefix, a URL or code. */
export function extractAllMessage(
  text: string,
  entities: readonly MessageEntity[] = [],
): string | null {
  const matches = [...text.matchAll(/(?<![\p{L}\p{N}_/@.])@all(?![\p{L}\p{N}_])/giu)].filter(
    (match) =>
      !entities.some(
        (entity) =>
          ['code', 'pre', 'url', 'email', 'text_link'].includes(entity.type) &&
          match.index >= entity.offset &&
          match.index < entity.offset + entity.length,
      ),
  )
  if (!matches.length) return null
  let result = text
  for (const match of matches.reverse())
    result = result.slice(0, match.index) + result.slice(match.index + match[0].length)
  return result.trim()
}
export function mentionMessages(
  body: string,
  people: readonly User[],
  heading = 'Everyone!',
): { text: string; entities: MessageEntity[] }[] {
  const chunks: { text: string; entities: MessageEntity[] }[] = []
  // Split long source text on Unicode code points without corrupting surrogate pairs.
  let source = ''
  for (const character of body) {
    if (source.length + character.length > 3500) {
      chunks.push({ text: source, entities: [] })
      source = ''
    }
    source += character
  }
  let current = { text: (source ? source + '\n\n' : '') + heading, entities: [] as MessageEntity[] }
  for (const user of people) {
    const label = (
      user.username
        ? '@' + user.username
        : [user.first_name, user.last_name].filter(Boolean).join(' ')
    ).slice(0, 160)
    if (current.text.length + label.length + 3 > 3800 || current.entities.length >= 50) {
      chunks.push(current)
      current = { text: heading, entities: [] }
    }
    current.text += ' · '
    const offset = current.text.length
    current.text += label
    current.entities.push({ type: 'text_mention', offset, length: label.length, user })
  }
  chunks.push(current)
  return chunks
}
const copy = {
  en: {
    heading: 'Everyone!',
    admin:
      'To use @all, make the portal bot a group administrator so it can receive messages and verify membership.',
    coverage: (count: number) =>
      `Mentioned ${count} verified members. Telegram does not share the full member list with bots. Missing members can send a message here or link their portal account for next time.`,
    failed:
      'The group notification could not be completed. Some mentions may have arrived; check the replies before trying @all again.',
  },
  ru: {
    heading: 'Всем!',
    admin:
      'Для @all назначьте бота администратором группы, чтобы он мог получать сообщения и проверять участников.',
    coverage: (count: number) =>
      `Упомянуто участников: ${count}. Telegram не передаёт ботам полный список. Остальным нужно отправить сообщение в группу или привязать аккаунт портала.`,
    failed:
      'Не удалось завершить оповещение. Некоторые упоминания могли быть доставлены; проверьте ответы перед повторным @all.',
  },
  uz: {
    heading: 'Barchaga!',
    admin:
      '@all uchun portal botini guruh administratori qiling. Shunda u xabarlarni qabul qilib, a’zolikni tekshira oladi.',
    coverage: (count: number) =>
      `${count} ta tasdiqlangan a’zo tilga olindi. Telegram botlarga to‘liq ro‘yxatni bermaydi. Qolgan a’zolar guruhga xabar yozishi yoki portal akkauntini bog‘lashi kerak.`,
    failed:
      'Guruhni xabardor qilish tugallanmadi. Ayrim xabarlar yetkazilgan bo‘lishi mumkin; @all ni takrorlashdan oldin javoblarni tekshiring.',
  },
}
const present = (member: { status: string; is_member?: boolean }) =>
  !['left', 'kicked'].includes(member.status) &&
  (member.status !== 'restricted' || member.is_member === true)
export function registerGroupMentions(bot: Bot) {
  bot.use(async (ctx, next) => {
    if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return next()
    const group = await connectedMentionGroup(ctx.chat.id)
    if (!group) return next()
    const update = ctx.chatMember
    if (update) {
      await rememberGroupMember(
        group.id,
        update.new_chat_member.user,
        present(update.new_chat_member),
      )
      return next()
    }
    const message = ctx.message
    if (!message) return next()
    if (message.from && !message.from.is_bot) await rememberGroupMember(group.id, message.from)
    for (const user of message.new_chat_members ?? []) await rememberGroupMember(group.id, user)
    if (message.left_chat_member)
      await rememberGroupMember(group.id, message.left_chat_member, false)
    if (message.forward_origin || (message.from?.is_bot && message.sender_chat?.id !== ctx.chat.id))
      return next()
    const body = extractAllMessage(
      message.text ?? message.caption ?? '',
      message.entities ?? message.caption_entities ?? [],
    )
    if (body === null) return next()
    const messages =
      copy[
        ctx.from?.language_code?.startsWith('ru')
          ? 'ru'
          : ctx.from?.language_code?.startsWith('en')
            ? 'en'
            : 'uz'
      ]
    if (await isMaintenanceActive()) return
    const own = await withTimeout(
      ctx.api.getChatMember(ctx.chat.id, ctx.me.id),
      8000,
      'telegram membership',
    )
    if (!['creator', 'administrator'].includes(own.status)) {
      await ctx.reply(messages.admin, { reply_parameters: { message_id: message.message_id } })
      return
    }
    if (!(await claimGroupMention(group.id, message.message_id))) return
    let notified = 0
    try {
      const administrators = await withTimeout(
        ctx.api.getChatAdministrators(ctx.chat.id),
        8000,
        'telegram administrators',
      )
      const candidates = Array.from(
        new Set([
          ...(await mentionCandidateIds(group.id, group.department_id)),
          ...administrators.map((m) => m.user.id),
        ]),
      )
      const people: User[] = []
      // Bounded network concurrency; every candidate is checked against this actual Telegram group.
      for (let i = 0; i < candidates.length; i += 5) {
        const batch = await Promise.all(
          candidates.slice(i, i + 5).map(async (id) => {
            try {
              // nosemgrep: query-in-loop -- This await is inside the concurrent five-member batch, with an eight-second bound.
              return await withTimeout(
                ctx.api.getChatMember(ctx.chat!.id, id),
                8000,
                'telegram membership',
              )
            } catch {
              return null
            }
          }),
        )
        for (const member of batch)
          if (member && present(member) && !member.user.is_bot) people.push(member.user)
      }
      const chunks = mentionMessages(body, people, messages.heading)
      for (const chunk of chunks) {
        // nosemgrep: query-in-loop -- Telegram chunks must stay in order and stop immediately after any failed delivery.
        const result = await sendMentionMessage(
          String(ctx.chat.id),
          chunk.text,
          chunk.entities,
          message.message_id,
          message.message_thread_id,
        )
        if (!result.ok) throw new Error('mention_delivery_failed')
        notified += chunk.entities.length
      }
      await finishGroupMention(group.id, message.message_id, true, notified)
      // Bot API cannot enumerate existing silent members. Never claim complete coverage from a partial roster.
      const count = await withTimeout(
        ctx.api.getChatMemberCount(ctx.chat.id),
        8000,
        'telegram member count',
      ).catch(() => null)
      if (count === null || people.length < count - 1)
        await ctx.reply(messages.coverage(people.length), {
          reply_parameters: { message_id: message.message_id },
          disable_notification: true,
        })
    } catch {
      await finishGroupMention(group.id, message.message_id, false, notified)
      await ctx.reply(messages.failed, {
        reply_parameters: { message_id: message.message_id },
        disable_notification: true,
      })
    }
  })
}

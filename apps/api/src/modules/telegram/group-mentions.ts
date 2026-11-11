import type { Bot } from 'grammy'
import type { MessageEntity, User } from 'grammy/types'
import { withTimeout } from '../../lib/resilience/timeout.js'
import { isMaintenanceActive } from '../notifications/repo.js'
import {
  claimGroupMention,
  connectedMentionGroup,
  finishGroupMention,
  groupMentionAudience,
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
    connections: (linked: number, total: number) =>
      `${linked}/${total} connected to the bot. Still to connect: `,
    failed:
      'The group notification could not be completed. Some mentions may have arrived; check the replies before trying @all again.',
  },
  ru: {
    heading: 'Всем!',
    admin:
      'Для @all назначьте бота администратором группы, чтобы он мог получать сообщения и проверять участников.',
    connections: (linked: number, total: number) =>
      `К боту подключены ${linked}/${total}. Ещё не подключились: `,
    failed:
      'Не удалось завершить оповещение. Некоторые упоминания могли быть доставлены; проверьте ответы перед повторным @all.',
  },
  uz: {
    heading: 'Barchaga!',
    admin:
      '@all uchun portal botini guruh administratori qiling. Shunda u xabarlarni qabul qilib, a’zolikni tekshira oladi.',
    connections: (linked: number, total: number) =>
      `Botga ulanganlar: ${linked}/${total}. Hali ulanmaganlar: `,
    failed:
      'Guruhni xabardor qilish tugallanmadi. Ayrim xabarlar yetkazilgan bo‘lishi mumkin; @all ni takrorlashdan oldin javoblarni tekshiring.',
  },
  'uz-Cyrl': {
    heading: 'Барчага!',
    admin: '@all учун портал ботини гуруҳ администратори қилинг.',
    connections: (linked: number, total: number) =>
      `Ботга уланганлар: ${linked}/${total}. Ҳали уланмаганлар: `,
    failed:
      'Айрим хабарлар етказилган бўлиши мумкин. @all ни такрорлашдан олдин жавобларни текширинг.',
  },
}
function mentionCopy(locale = '') {
  if (locale.startsWith('ru')) return copy.ru
  if (locale.startsWith('en')) return copy.en
  if (locale.startsWith('uz-Cyrl')) return copy['uz-Cyrl']
  return copy.uz
}
const present = (member: { status: string; is_member?: boolean }) =>
  !['left', 'kicked'].includes(member.status) &&
  (member.status !== 'restricted' || member.is_member === true)

/** Both sources of @all use the same verified Telegram recipients and portal connection counts. */
export async function groupMentionMessages(
  api: Bot['api'],
  chatId: string | number,
  groupId: string,
  departmentId: string,
  body: string,
  locale?: string,
) {
  const audience = await groupMentionAudience(groupId, departmentId)
  const administrators = await withTimeout(
    api.getChatAdministrators(chatId),
    8000,
    'telegram administrators',
  )
  const candidates = [...new Set([...audience.candidates, ...administrators.map((m) => m.user.id)])]
  const people: User[] = []
  for (let i = 0; i < candidates.length; i += 5) {
    const members = await Promise.all(
      candidates
        .slice(i, i + 5)
        .map((id) =>
          withTimeout(api.getChatMember(chatId, id), 8000, 'telegram membership').catch(() => null),
        ),
    )
    for (const member of members)
      if (member && present(member) && !member.user.is_bot) people.push(member.user)
  }
  const messages = mentionCopy(locale ?? audience.locale)
  const chunks = mentionMessages(body, people, messages.heading)
  if (!audience.missing.length) return chunks

  // Keep the status on the last message where it fits. Start a continuation at a name
  // boundary for large departments, so names and existing UTF-16 mention offsets stay intact.
  const prefix = messages.connections(audience.connected, audience.total)
  let note = prefix
  for (const member of audience.missing) {
    const name = member.replace(/\s+/gu, ' ').trim()
    if (note.length + name.length + 2 > 4096) {
      chunks.push({ text: note, entities: [] })
      note = prefix
    }
    note += (note === prefix ? '' : ', ') + name
  }
  const last = chunks[chunks.length - 1]!
  if (last.text.length + note.length + 2 <= 4096) last.text += '\n\n' + note
  else chunks.push({ text: note, entities: [] })
  return chunks
}

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
    const messages = mentionCopy(ctx.from?.language_code)
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
      const chunks = await groupMentionMessages(
        ctx.api,
        ctx.chat.id,
        group.id,
        group.department_id,
        body,
        ctx.from?.language_code,
      )
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
    } catch {
      await finishGroupMention(group.id, message.message_id, false, notified)
      await ctx.reply(messages.failed, {
        reply_parameters: { message_id: message.message_id },
        disable_notification: true,
      })
    }
  })
}

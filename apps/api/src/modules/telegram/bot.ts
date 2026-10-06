// grammY command/callback wiring (TECH-SPEC §7): `/today /mytasks /events /mute`, `/start <code>`
// linking, `/connect <code>` for a department group, and inline-button actions (RSVP, mark done,
// snooze). One `Bot` instance, shared by the webhook route and the local-dev polling fallback
// (`index.ts` picks exactly one of the two per process, per grammY's own constraint against running
// both against the same bot at once).
import type { Bot, Context } from 'grammy'
import {
  archiveNotifications,
  emitActionRequested,
  getNotificationById,
  isMaintenanceActive,
  listNotifications,
  markRead,
  snoozeNotification,
  systemAuditCtx,
} from '../notifications/repo.js'
import {
  consumeGroupConnectCode,
  consumeLinkCode,
  disconnectGroupByChatId,
  getDepartmentName,
  resolveGroupByChatId,
  resolveUserByChatId,
  setMutedUntil,
} from './repo.js'
import { DEFAULT_BOT_LOCALE, isBotLocale, tb, type BotLocale } from './templates.js'
import { miniappMenuKeyboard } from './miniapp-buttons.js'

function localeFromTelegram(ctx: Context): BotLocale {
  const code = ctx.from?.language_code
  if (code?.startsWith('ru')) return 'ru'
  if (code?.startsWith('en')) return 'en'
  return DEFAULT_BOT_LOCALE
}

function chatIdOf(ctx: Context): string | null {
  const id = ctx.chat?.id
  return id === undefined ? null : String(id)
}

/** Resolves the linked user for this chat, or replies with the "link your account first" prompt and
 * returns `null`. Every personal command (`/today`, `/mytasks`, `/events`, `/mute`) starts with this. */
async function requireLinkedUser(
  ctx: Context,
): Promise<{ userId: string; locale: BotLocale } | null> {
  if (ctx.chat?.type !== 'private') return null
  const chatId = chatIdOf(ctx)
  if (!chatId) return null
  const resolved = await resolveUserByChatId(chatId)
  if (!resolved) {
    await ctx.reply(tb(localeFromTelegram(ctx), 'link.prompt_needed'))
    return null
  }
  const locale = isBotLocale(resolved.locale) ? resolved.locale : localeFromTelegram(ctx)
  return { userId: resolved.userId, locale }
}

function renderTitleList(items: { title: Record<string, string> }[], locale: BotLocale): string {
  return items.map((n, i) => `${i + 1}. ${n.title[locale] ?? n.title['uz-Latn']}`).join('\n')
}

/** Same resolution `requireLinkedUser` uses (the account's own saved locale for a linked chat, the
 * client's Telegram language otherwise) -- duplicated rather than shared because that function also
 * sends its own "link your account" reply on a miss, which the maintenance message below must never
 * trigger (a maintenance reply is the one response every chat gets, linked or not). */
async function resolveLocale(ctx: Context): Promise<BotLocale> {
  const chatId = chatIdOf(ctx)
  const resolved = chatId ? await resolveUserByChatId(chatId) : null
  if (resolved && isBotLocale(resolved.locale)) return resolved.locale
  return localeFromTelegram(ctx)
}

export function registerBotHandlers(bot: Bot): void {
  // TECH-SPEC §11 (pause/wipe): the app-wide maintenance screen and the API's 503 already stop every
  // ordinary request; the bot is the one surface that would otherwise keep answering as if nothing
  // were wrong. Runs before every command/callback handler below, in the user's own locale, and never
  // falls through to them while maintenance is active.
  bot.use(async (ctx, next) => {
    const isCommand = typeof ctx.message?.text === 'string' && ctx.message.text.startsWith('/')
    if (!isCommand && !ctx.callbackQuery) return next()
    if (!(await isMaintenanceActive())) return next()

    const locale = await resolveLocale(ctx)
    const message = tb(locale, 'maintenance')
    if (ctx.callbackQuery) {
      // A toast on the button itself, not a new chat message -- same convention the real
      // `callback_query:data` handler below uses to close the "loading" spinner on a button tap.
      await ctx.answerCallbackQuery({ text: message, show_alert: true })
    } else {
      await ctx.reply(message)
    }
  })

  bot.command('start', async (ctx) => {
    const code = ctx.match?.toString().trim()
    const chatId = chatIdOf(ctx)
    const locale = localeFromTelegram(ctx)
    if (!chatId) return
    // A personal link receives private reminders and reset codes. Never bind it to a group,
    // even when somebody pastes their one-time code into the wrong conversation.
    if (ctx.chat.type !== 'private') return
    if (!code) {
      await ctx.reply(tb(locale, 'help'))
      return
    }
    const result = await consumeLinkCode(code, chatId, locale)
    if (!result.ok) {
      const key =
        result.reason === 'expired'
          ? 'link.expired'
          : result.reason === 'already_used'
            ? 'link.already_used'
            : 'link.not_found'
      await ctx.reply(tb(locale, key))
      return
    }
    const startKeyboard = miniappMenuKeyboard(locale)
    await ctx.reply(
      tb(locale, 'link.success', { name: ctx.from?.first_name ?? '' }),
      startKeyboard ? { reply_markup: startKeyboard } : undefined,
    )
  })

  bot.command('help', async (ctx) => {
    const locale = localeFromTelegram(ctx)
    const keyboard = miniappMenuKeyboard(locale)
    await ctx.reply(tb(locale, 'help'), keyboard ? { reply_markup: keyboard } : undefined)
  })

  // v1.1 SPEC §9: "Bot commands open the Mini App via a web_app button". `/app` is the one command
  // whose whole purpose is that button; every other command keeps its text answer and simply carries
  // the button alongside, so a person on a Telegram client too old for Mini Apps loses nothing.
  bot.command('app', async (ctx) => {
    const linked = await requireLinkedUser(ctx)
    if (!linked) return
    const keyboard = miniappMenuKeyboard(linked.locale)
    if (!keyboard) {
      await ctx.reply(tb(linked.locale, 'miniapp.not_available'))
      return
    }
    await ctx.reply(tb(linked.locale, 'miniapp.app_intro'), { reply_markup: keyboard })
  })

  bot.command('today', async (ctx) => {
    const linked = await requireLinkedUser(ctx)
    if (!linked) return
    const { items } = await listNotifications(linked.userId, {
      status: 'unread',
      reason: 'due',
      limit: 10,
    })
    if (items.length === 0) {
      await ctx.reply(tb(linked.locale, 'today.empty'))
      return
    }
    await ctx.reply(
      `${tb(linked.locale, 'today.header')}\n${renderTitleList(items, linked.locale)}`,
    )
  })

  bot.command('mytasks', async (ctx) => {
    const linked = await requireLinkedUser(ctx)
    if (!linked) return
    const { items } = await listNotifications(linked.userId, { status: 'inbox', limit: 10 })
    if (items.length === 0) {
      await ctx.reply(tb(linked.locale, 'mytasks.empty'))
      return
    }
    await ctx.reply(
      `${tb(linked.locale, 'mytasks.header')}\n${renderTitleList(items, linked.locale)}`,
    )
  })

  bot.command('events', async (ctx) => {
    const linked = await requireLinkedUser(ctx)
    if (!linked) return
    const { items } = await listNotifications(linked.userId, { status: 'inbox', limit: 30 })
    const upcoming = items
      .filter((n) => n.eventAt && n.eventAt.getTime() >= Date.now())
      .slice(0, 10)
    if (upcoming.length === 0) {
      await ctx.reply(tb(linked.locale, 'events.empty'))
      return
    }
    await ctx.reply(
      `${tb(linked.locale, 'events.header')}\n${renderTitleList(upcoming, linked.locale)}`,
    )
  })

  bot.command('mute', async (ctx) => {
    const linked = await requireLinkedUser(ctx)
    if (!linked) return
    const arg = ctx.match?.toString().trim()
    const minutes = arg ? Number.parseInt(arg, 10) : Number.NaN
    if (arg === undefined || arg === '' || Number.isNaN(minutes) || minutes < 0) {
      await ctx.reply(tb(linked.locale, 'mute.usage'))
      return
    }
    if (minutes === 0) {
      await setMutedUntil(linked.userId, null)
      await ctx.reply(tb(linked.locale, 'mute.off'))
      return
    }
    await setMutedUntil(linked.userId, new Date(Date.now() + minutes * 60_000))
    await ctx.reply(tb(linked.locale, 'mute.on', { minutes }))
  })

  bot.command('connect', async (ctx) => {
    const chatId = chatIdOf(ctx)
    const locale = localeFromTelegram(ctx)
    if (!chatId || (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup')) return
    const code = ctx.match?.toString().trim()
    if (!code) {
      await ctx.reply(tb(locale, 'group.connect_usage'))
      return
    }
    const linkedActor = await resolveUserByChatId(chatId) // rarely set for a group chat itself; kept for completeness
    const result = await consumeGroupConnectCode(
      code,
      chatId,
      ctx.chat.title ?? null,
      linkedActor?.userId ?? null,
    )
    if (!result.ok) {
      const key =
        result.reason === 'already_used' ? 'group.connect_already_used' : 'group.connect_invalid'
      await ctx.reply(tb(locale, key))
      return
    }
    const departmentName = (await getDepartmentName(result.departmentId)) ?? result.departmentId
    await ctx.reply(tb(locale, 'group.connected', { department: departmentName }))
  })

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    const chatId = chatIdOf(ctx)
    if (!chatId) return
    const resolved = await resolveUserByChatId(chatId)
    if (!resolved) {
      await ctx.answerCallbackQuery()
      return
    }
    const locale: BotLocale = isBotLocale(resolved.locale)
      ? resolved.locale
      : localeFromTelegram(ctx)
    const userId = resolved.userId
    const auditCtx = systemAuditCtx(userId)

    const [action, a, b] = data.split(':')
    if (action === 'done' && a) {
      await archiveNotifications(auditCtx, userId, [a])
      await ctx.answerCallbackQuery({ text: tb(locale, 'action.acknowledged') })
      return
    }
    if (action === 'snooze' && a) {
      await snoozeNotification(auditCtx, userId, a, new Date(Date.now() + 24 * 60 * 60_000))
      await ctx.answerCallbackQuery({ text: tb(locale, 'action.snoozed') })
      return
    }
    if (action === 'rsvp' && a && b) {
      const choice = a as 'yes' | 'no' | 'maybe'
      const notification = await getNotificationById(userId, b)
      if (notification) {
        await emitActionRequested(
          userId,
          `rsvp_${choice}`,
          notification.subjectType,
          notification.subjectId ?? b,
        )
        await markRead(auditCtx, userId, [b])
      }
      const choiceLabel = tb(
        locale,
        choice === 'yes'
          ? 'button.rsvp_yes'
          : choice === 'no'
            ? 'button.rsvp_no'
            : 'button.rsvp_maybe',
      )
      await ctx.answerCallbackQuery({
        text: tb(locale, 'action.rsvp_recorded', { choice: choiceLabel }),
      })
      return
    }
    await ctx.answerCallbackQuery()
  })

  bot.on('my_chat_member', async (ctx) => {
    // Bot added to / removed from a group -- no action needed beyond letting `/connect` (above) do the
    // real work once someone runs it; kept as a no-op handler so grammY does not warn about an
    // unhandled update type, and so a future kind (auto-detecting removal to mark a group disconnected)
    // has a documented place to land.
    if (
      ctx.myChatMember.new_chat_member.status === 'left' ||
      ctx.myChatMember.new_chat_member.status === 'kicked'
    ) {
      const chatId = chatIdOf(ctx)
      if (chatId && (await resolveGroupByChatId(chatId))) {
        await disconnectGroupByChatId(chatId).catch(() => {})
      }
    }
  })
}

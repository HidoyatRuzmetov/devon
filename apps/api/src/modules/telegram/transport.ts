// The bot client and the "pointer not payload" send path (TECH-SPEC §7). `TELEGRAM_BOT_TOKEN` is read
// directly from `process.env` -- this module's own, narrowly-scoped config, never added to the shared
// `apps/api/src/config.ts` (outside this module's paths); a module reading its own optional env var
// this way is the same pattern `packages/db/src/context.ts` already uses for `DATABASE_URL`.
//
// "If a bot token is not configured, the module must run with a no-op transport and show a clear
// settings hint" (this module's task): every function below degrades to a documented no-op when
// `getBot()` returns `null`, never throws, and the web settings screen reads `isTelegramConfigured()`
// to render that hint (`GET /api/v1/telegram/status`, `index.ts`).
import { Bot, InlineKeyboard } from 'grammy'
import type { NotificationRow } from '../notifications/repo.js'
import { absoluteDeepLink, buildTelegramPointer } from './pointer.js'
import { DEFAULT_BOT_LOCALE, isBotLocale, tb, type BotLocale } from './templates.js'
import { getLinkStatus, getTelegramLinkLocale } from './repo.js'

let cachedBot: Bot | null = null
let cachedToken: string | null = null

function readToken(): string | null {
  const raw = process.env['TELEGRAM_BOT_TOKEN']
  const trimmed = raw?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

export function isTelegramConfigured(): boolean {
  return readToken() !== null
}

export function publicUrl(): string {
  return process.env['DEVON_PUBLIC_URL']?.trim() || 'http://localhost:5173'
}

/** Lazily constructs (and caches) the grammY `Bot` -- `null` when no token is configured. Re-reads the
 * env var each call (cheap) so a token added to a running process's environment via a supervisor
 * reload picks up without a restart; the constructed `Bot` instance itself is cached and only rebuilt
 * if the token value actually changes. */
export function getBot(): Bot | null {
  const token = readToken()
  if (!token) {
    cachedBot = null
    cachedToken = null
    return null
  }
  if (cachedBot && cachedToken === token) return cachedBot
  cachedBot = new Bot(token)
  cachedToken = token
  return cachedBot
}

export type SendResult = { ok: true; messageId: number } | { ok: false; error: string }

async function resolveLocale(userId: string): Promise<BotLocale> {
  const locale = await getTelegramLinkLocale(userId)
  return isBotLocale(locale) ? locale : DEFAULT_BOT_LOCALE
}

function formatDateLine(eventAt: string | null, locale: BotLocale): string | null {
  if (!eventAt) return null
  const date = new Date(eventAt)
  if (Number.isNaN(date.getTime())) return null
  const localeTag = locale === 'ru' ? 'ru-RU' : locale === 'en' ? 'en-GB' : 'uz-Latn-u-ca-gregory'
  try {
    return new Intl.DateTimeFormat(localeTag, {
      timeZone: 'Asia/Tashkent',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** Sends one notification to one linked chat. `userId` selects the render locale (the notification's
 * own `title`/`body` are already localized to all four; this just picks which one). Never throws --
 * every failure path returns `{ ok: false, error }` for the caller to record on
 * `notification_deliveries`. */
export async function sendTelegramNotification(
  chatId: string,
  notification: NotificationRow,
  userId: string,
): Promise<SendResult> {
  const bot = getBot()
  if (!bot) return { ok: false, error: 'telegram_not_configured' }

  const locale = await resolveLocale(userId)
  const titleText = notification.title[locale] ?? notification.title['uz-Latn']
  const bodyText = notification.body
    ? (notification.body[locale] ?? notification.body['uz-Latn'])
    : null
  const pointer = buildTelegramPointer({
    title: titleText,
    body: bodyText,
    deepLink: notification.deepLink,
    eventAt: notification.eventAt ? notification.eventAt.toISOString() : null,
  })

  const lines = [pointer.title]
  const dateLine = formatDateLine(pointer.eventAt, locale)
  if (dateLine) lines.push(dateLine)
  if (pointer.body) lines.push(pointer.body)
  const text = lines.join('\n')

  const url = absoluteDeepLink(publicUrl(), pointer.deepLink)
  const keyboard = buildActionKeyboard(notification, locale, url)

  try {
    const sent = await withTimeout(
      bot.api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : undefined),
      8000,
    )
    return { ok: true, messageId: sent.message_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Inline buttons (TECH-SPEC §7: "inline buttons for RSVP, poll vote, mark done, snooze deadline").
 * Every callback_data value is a small, structured pointer (`action:subjectType:subjectId`) -- never
 * the notification's own free-text title/body -- kept under Telegram's 64-byte callback_data limit. */
function buildActionKeyboard(
  notification: NotificationRow,
  locale: BotLocale,
  url: string | null,
): InlineKeyboard | null {
  const kb = new InlineKeyboard()
  let any = false
  if (notification.reason === 'rsvp') {
    kb.text(tb(locale, 'button.rsvp_yes'), `rsvp:yes:${notification.id}`)
    kb.text(tb(locale, 'button.rsvp_no'), `rsvp:no:${notification.id}`)
    kb.text(tb(locale, 'button.rsvp_maybe'), `rsvp:maybe:${notification.id}`)
    any = true
  } else if (notification.reason === 'due' || notification.reason === 'assigned') {
    kb.text(tb(locale, 'button.mark_done'), `done:${notification.id}`).row()
    kb.text(tb(locale, 'button.snooze_1d'), `snooze:${notification.id}`)
    any = true
  }
  if (url) {
    if (any) kb.row()
    kb.url(tb(locale, 'button.open'), url)
    any = true
  }
  return any ? kb : null
}

/**
 * Reset/2FA code delivery hook (this module's task). A future auth flow that needs to hand a
 * short-lived numeric code to a user calls this directly (the same intra-package import pattern
 * `notifications/jobs.ts` already uses for `getBot`/`listGroupsForKind`) -- it never goes through the
 * domain-event bus, because a verification code is a synchronous "did this send?" operation the
 * caller needs the `SendResult` for immediately, not a fire-and-forget notification.
 *
 * Bypasses `resolveTelegramChatId`'s mute check on purpose: muting silences routine notification
 * noise, never a security code the user themselves just requested. Still "pointer not payload" in
 * spirit -- the code is the one thing this message exists to carry, and nothing else about the user
 * (no email, no phone, no IP) ever appears in it. Returns `{ ok: false, error: 'telegram_not_linked'
 * }` when the account has no linked chat -- the caller falls back to its other delivery channel
 * (email, SMS, whatever this instance configures) exactly as it would for `'telegram_not_configured'`.
 */
export async function sendVerificationCode(
  userId: string,
  code: string,
  validForMinutes: number,
): Promise<SendResult> {
  const bot = getBot()
  if (!bot) return { ok: false, error: 'telegram_not_configured' }

  const status = await getLinkStatus(userId)
  if (!status.linked || !status.chatId) return { ok: false, error: 'telegram_not_linked' }

  const locale = await resolveLocale(userId)
  const text = tb(locale, 'security.code', { code, minutes: validForMinutes })

  try {
    const sent = await withTimeout(bot.api.sendMessage(status.chatId, text), 8000)
    return { ok: true, messageId: sent.message_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`telegram send timed out after ${ms}ms`)), ms),
    ),
  ])
}

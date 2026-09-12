// The `web_app` buttons that open the Mini App from a chat (v1.1 SPEC §9: "Bot commands open the
// Mini App via a web_app button").
//
// Telegram refuses a `web_app` button whose URL is not HTTPS -- an `http://localhost` development
// instance would make every keyboard in the bot fail to send, taking the ordinary notification with
// it. So every builder here is *conditional*: HTTPS gets a real `web_app` button, anything else
// degrades to the plain `url` button the bot already used, and a bot with no configured public URL
// gets no button at all. The caller never has to know which case it is in.
import { InlineKeyboard } from 'grammy'
import { miniappUrl } from './miniapp.js'
import { tb, type BotLocale } from './templates.js'

/** The Mini App's hash routes, named once so the bot and the client cannot drift.
 * `apps/miniapp/src/lib/routes.ts` carries the same list. */
export const MINIAPP_ROUTES = {
  today: '#/',
  inbox: '#/inbox',
  board: '#/board',
  events: '#/events',
  focus: '#/focus',
  fields: '#/fields',
  setup: '#/setup',
} as const

export type MiniappRouteKey = keyof typeof MINIAPP_ROUTES

export function miniappHref(route: MiniappRouteKey): string {
  return `${miniappUrl()}${MINIAPP_ROUTES[route]}`
}

function isHttps(url: string): boolean {
  return url.startsWith('https://')
}

/** Adds one `web_app` button to an existing keyboard when the instance can host one; returns whether
 * it did, so the caller can decide about a separator row. */
export function addMiniappButton(
  kb: InlineKeyboard,
  locale: BotLocale,
  route: MiniappRouteKey,
  labelKey: Parameters<typeof tb>[1] = 'miniapp.open',
): boolean {
  const href = miniappHref(route)
  if (!isHttps(href)) return false
  kb.webApp(tb(locale, labelKey), href)
  return true
}

/** The keyboard `/app` replies with: one row of the screens a xodim opens most, then the board.
 * Empty (`null`) on a non-HTTPS instance, where the caller sends the "not available yet" copy. */
export function miniappMenuKeyboard(locale: BotLocale): InlineKeyboard | null {
  if (!isHttps(miniappUrl())) return null
  const kb = new InlineKeyboard()
  kb.webApp(tb(locale, 'miniapp.open_today'), miniappHref('today'))
  kb.webApp(tb(locale, 'miniapp.open_inbox'), miniappHref('inbox')).row()
  kb.webApp(tb(locale, 'miniapp.open_board'), miniappHref('board'))
  kb.webApp(tb(locale, 'miniapp.open_events'), miniappHref('events')).row()
  kb.webApp(tb(locale, 'miniapp.open_focus'), miniappHref('focus'))
  kb.webApp(tb(locale, 'miniapp.open_fields'), miniappHref('fields'))
  return kb
}

/** Which Mini App screen a notification of this `reason` should land on. Keeps the inline "open in
 * the app" button pointing somewhere useful instead of always dropping the reader on the home tab. */
export function routeForReason(reason: string): MiniappRouteKey {
  if (reason === 'rsvp' || reason === 'poll') return 'events'
  if (reason === 'due' || reason === 'assigned' || reason === 'mentioned' || reason === 'updated') {
    return 'inbox'
  }
  return 'today'
}

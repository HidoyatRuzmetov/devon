// A 60-line hash router, because a Mini App is one static file behind whatever reverse proxy an
// instance runs and a hash survives a reload inside Telegram's webview with no rewrite rule at all.
// The route *names* are shared with the bot through `@devon/contracts`'s `MINIAPP_ROUTES`, so a
// `web_app` button can never point at a screen that no longer exists.
import * as React from 'react'
import { MINIAPP_ROUTES, isMiniappRouteKey, type MiniappRouteKey } from '@devon/contracts'

/** A parsed location. `card` is the one screen that carries an id; everything else is a bare tab. */
export type Route =
  | { name: MiniappRouteKey }
  | { name: 'card'; cardId: string }
  | { name: 'event'; eventId: string }

export const DEFAULT_ROUTE: Route = { name: 'today' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const segments = path.split('/').filter((s) => s !== '')
  if (segments.length === 0) return DEFAULT_ROUTE
  const [head, second] = segments
  if (head === 'card' && second) return { name: 'card', cardId: second }
  if (head === 'event' && second) return { name: 'event', eventId: second }
  if (head && isMiniappRouteKey(head)) return { name: head }
  return DEFAULT_ROUTE
}

export function hrefFor(route: Route): string {
  if (route.name === 'card') return `#/card/${route.cardId}`
  if (route.name === 'event') return `#/event/${route.eventId}`
  return MINIAPP_ROUTES[route.name]
}

export function navigate(route: Route): void {
  const next = hrefFor(route)
  if (window.location.hash === next) return
  window.location.hash = next
}

export function goBack(fallback: Route = DEFAULT_ROUTE): void {
  // `history.length > 1` is the only signal a webview gives about "is there anywhere to go back to";
  // when there is not (a deep link straight into a card), the fallback keeps the back button from
  // dead-ending inside the sheet.
  if (window.history.length > 1) window.history.back()
  else navigate(fallback)
}

/** `?startapp=inbox` (Telegram's deep-link parameter) opens that tab on first paint -- that is how
 * the bot's "Bildirishnomalar" button and the notify-to-fill message land on the right screen. */
export function routeFromStartParam(startParam: string | null): Route | null {
  if (!startParam) return null
  const [head, second] = startParam.split('_')
  if (head === 'card' && second) return { name: 'card', cardId: second }
  if (head === 'event' && second) return { name: 'event', eventId: second }
  if (head && isMiniappRouteKey(head)) return { name: head }
  return null
}

export function useRoute(): Route {
  const subscribe = React.useCallback((onChange: () => void) => {
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const hash = React.useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )
  return React.useMemo(() => parseHash(hash), [hash])
}

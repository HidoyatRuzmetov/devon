// Locale resolution and persistence (design.md §4.3/§8, AC-4). Resolution order per the item
// handoff -- user record → localStorage → Accept-Language → uz-Latn: the user-record tier is applied
// separately, once `GET /api/v1/me` resolves (`reconcileLocaleWithUser` below), because it needs a
// network round trip that must never block first paint; `bootLocale()` covers the other three tiers
// synchronously so there is no flash of the wrong language before that round trip completes.
import { resolveLocale, setLocale, type Locale } from '@devon/i18n'
import { LOCALE_COOKIE_NAME, LOCALE_STORAGE_KEY } from './constants.js'

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

function readCookieLocale(): string | null {
  const match = /(?:^|;\s*)wp_locale=([^;]+)/.exec(document.cookie)
  const value = match?.[1]
  return value ? decodeURIComponent(value) : null
}

/** Called once, before the first render (`main.tsx`). */
export function bootLocale(): void {
  const resolved = resolveLocale({
    stored: readStoredLocale() ?? readCookieLocale(),
    // There is no server request in a pure SPA to read `Accept-Language` from; `navigator.language`
    // is the client-side equivalent the resolution order's third tier stands in for.
    header: typeof navigator === 'undefined' ? null : navigator.language,
  })
  setLocale(resolved)
}

/** Signed-in persistence writes to the user record (`PATCH /api/v1/me`, done by the caller); this
 * mirror is written unconditionally either way -- design.md §8: "+ localStorage mirror (survives
 * reload before /me resolves, so there is no flash of the default locale)" applies to both the
 * signed-in and signed-out cases. The `wp_locale` cookie is the signed-out persistence path proper
 * (design.md §4.3), 1 year, `SameSite=Lax`. */
export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage disabled -- the in-memory `setLocale()` call already happened; this session just will
    // not remember the choice across a reload.
  }
  const oneYearSeconds = 60 * 60 * 24 * 365
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Max-Age=${oneYearSeconds}; Path=/; SameSite=Lax`
}

/** First tier of the resolution order: once the signed-in user's own record is known, it wins over
 * whatever `bootLocale()` guessed from storage/header. A no-op when the user's stored preference
 * already matches (keeps `setLocale`'s referential-stability guarantee intact, `@devon/i18n`'s
 * `store.ts`). */
export function reconcileLocaleWithUser(userLocale: Locale): void {
  setLocale(userLocale)
  persistLocale(userLocale)
}

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

/** The locale this session should open in, from storage/cookie alone. Split out of `bootLocale()`
 *  for `main.tsx`, which has to know the answer *before* it sets it: `@devon/i18n` now ships only
 *  the default catalogue in the shell chunk, so a session opening in ru or uz-Cyrl awaits that one
 *  catalogue and only then sets the locale -- which is what keeps "no flash of the wrong language"
 *  true now that a catalogue can arrive a moment late. */
export function resolveBootLocale(): Locale {
  // v1.1 (WALKTHROUGH-FINDINGS §5.5): the browser's own language is deliberately NOT consulted any
  // more. A ministry workstation is very often an English or Russian Windows install, so the first
  // screen a civil servant ever saw was in English -- and the first screen is a login form, where
  // there is no signed-in preference to fall back on yet. uz-Latn is the product's language; a
  // person who wants another one picks it from the locale menu once and it is remembered (stored
  // locale / `wp_locale` cookie, both still honoured above, and the signed-in user record wins over
  // both in `reconcileLocaleWithUser`).
  return resolveLocale({
    stored: readStoredLocale() ?? readCookieLocale(),
    header: null,
  })
}

/** Called once, before the first render. Kept as the synchronous form for callers that already
 *  have every catalogue in memory (the unit tests, which register all four). */
export function bootLocale(): void {
  setLocale(resolveBootLocale())
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

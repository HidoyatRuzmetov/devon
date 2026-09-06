// The active-locale store. Deliberately not a React Context: `t()` (a plain function, usable
// outside components -- toasts, non-React callers, the CLI break scripts) and `useT()` (a hook)
// must read the same value, so there is exactly one source of truth and one subscription list.
import { DEFAULT_LOCALE, isLocale, type Locale } from './locale.js'
import { isDev } from './env.js'

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

/** Called once on boot (after `resolveLocale()`) and again whenever the user switches locale from
 *  the LocaleMenu (spec.md §4.3). A no-op on an already-active locale keeps `useT()` referentially
 *  stable across repeated calls. */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) {
    if (isDev())
      console.error(`[i18n] setLocale() ignored an unknown locale: ${JSON.stringify(next)}`)
    return
  }
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test-only escape hatch: production code should only ever call `setLocale()`. */
export function resetLocaleForTests(): void {
  current = DEFAULT_LOCALE
}

// The active-locale store. Deliberately not a React Context: `t()` (a plain function, usable
// outside components -- toasts, non-React callers, the CLI break scripts) and `useT()` (a hook)
// must read the same value, so there is exactly one source of truth and one subscription list.
import { DEFAULT_LOCALE, isLocale, type Locale } from './locale.js'
import { hasCatalogue, loadCatalogue } from './messages.js'
import { isDev } from './env.js'

let current: Locale = DEFAULT_LOCALE
/** The locale most recently asked for, which is `current` except while a catalogue is in flight. */
let requested: Locale = DEFAULT_LOCALE
const listeners = new Set<() => void>()
let requestVersion = 0
let failedLocale: Locale | null = null
const failureListeners = new Set<() => void>()

function updateFailure(locale: Locale | null): void {
  if (failedLocale === locale) return
  failedLocale = locale
  for (const listener of failureListeners) listener()
}

export function getLocaleLoadFailure(): Locale | null {
  return failedLocale
}

export function subscribeLocaleLoadFailure(listener: () => void): () => void {
  failureListeners.add(listener)
  return () => failureListeners.delete(listener)
}

export function getLocale(): Locale {
  return current
}

function commit(next: Locale): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

/** Called once on boot (after `resolveLocale()`) and again whenever the user switches locale from
 *  the LocaleMenu (spec.md §4.3). A no-op on an already-active locale keeps `useT()` referentially
 *  stable across repeated calls.
 *
 *  Stays synchronous whenever the target locale's catalogue is already in memory -- which is every
 *  Node-side caller (they import `@devon/i18n/catalogues`) and every locale a browser has visited
 *  before. When it is not, the switch waits for the chunk instead of flipping first: this package
 *  has no fallback locale by design (locale.js), so switching early would paint a screen of
 *  bracketed keys. The wait is one same-origin static chunk. */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) {
    if (isDev())
      console.error(`[i18n] setLocale() ignored an unknown locale: ${JSON.stringify(next)}`)
    return
  }
  requested = next
  const version = ++requestVersion
  updateFailure(null)
  if (next === current) return
  if (hasCatalogue(next)) {
    commit(next)
    return
  }
  void loadCatalogue(next)
    .then(() => {
      // Guarded, not assumed: somebody clicking through the locale menu can land a second switch
      // while this chunk is in the air, and the last locale asked for is the one they meant -- an
      // unconditional commit here would snap the UI back to the one they passed through.
      if (requested === next && requestVersion === version) commit(next)
    })
    .catch(() => {
      // Keep the loaded language usable and expose an explicit recovery state. A late rejection
      // from a superseded choice must not replace the user's newer successful choice.
      if (requested === next && requestVersion === version) updateFailure(next)
    })
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test-only escape hatch: production code should only ever call `setLocale()`. */
export function resetLocaleForTests(): void {
  current = DEFAULT_LOCALE
  requested = DEFAULT_LOCALE
  requestVersion += 1
  updateFailure(null)
}

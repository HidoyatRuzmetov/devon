// React binding. Kept in its own module (not merged into t.ts) so that a non-React consumer of
// `t()` -- a CLI script, a future server-side literal-formatting need -- never has to resolve
// `react` at all; only importing `useT`/`useLocale` from the package barrel pulls this in.
import { useCallback, useSyncExternalStore } from 'react'
import { translate, type TParams } from './t.js'
import { getLocale, subscribeLocale } from './store.js'
import type { Locale } from './locale.js'

/** Re-renders the calling component whenever `setLocale()` changes the active locale (the
 *  LocaleMenu switch, spec.md §4.3: "the change is its own feedback ... no page reload"). */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}

/** The hook form of `t()`, bound to the reactive locale so a locale switch re-renders every
 *  consumer without a page reload. The returned function is stable across renders while the
 *  locale does not change. */
export function useT(): (key: string, params?: TParams) => string {
  const locale = useLocale()
  return useCallback((key: string, params?: TParams) => translate(locale, key, params), [locale])
}

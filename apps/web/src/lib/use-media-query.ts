import { useSyncExternalStore } from 'react'

/** One instance per distinct query string per render tree is fine -- `matchMedia` is cheap and this
 * hook is only called a handful of times per shell render (drawer breakpoint, search-trigger
 * compactness, toast position). Reactive to a live viewport change (window resize / orientation),
 * not just read once on mount -- same shape as `@devon/ui`'s `useReducedMotion`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    () =>
      typeof window === 'undefined' || !window.matchMedia
        ? false
        : window.matchMedia(query).matches,
    () => false,
  )
}

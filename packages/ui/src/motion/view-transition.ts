/** View Transitions, feature-detected (DESIGN.md §2.5: "View Transitions (feature-detected, router
 * update inside the callback) for routes"). Nothing in this file throws or waits on an unsupported
 * browser -- the update callback simply runs synchronously and the caller's `AnimatePresence`
 * fallback does the animating instead. */

export function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') return false
  return typeof document.startViewTransition === 'function'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Runs `update` inside a view transition when the browser has one and the user has not asked for
 * reduced motion; otherwise runs it directly. Returns a promise that resolves when the transition
 * has finished (immediately, in the fallback), so a caller can chain without branching. */
export function startViewTransition(update: () => void): Promise<void> {
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    update()
    return Promise.resolve()
  }
  try {
    return document.startViewTransition(update).finished.catch(() => undefined)
  } catch {
    // A transition already in flight (or a browser that advertises the API but rejects a nested
    // call) must never swallow the navigation itself.
    update()
    return Promise.resolve()
  }
}

/** The `view-transition-name` the page container carries; `styles/tokens.css` defines the paired
 * `::view-transition-old/new(devon-page)` animations (crossfade + 8 px slide). */
export const PAGE_VIEW_TRANSITION_NAME = 'devon-page'

/** The `view-transition-name` used by the theme toggle's circular reveal. */
export const THEME_VIEW_TRANSITION_NAME = 'devon-theme'

/** Set on `<html>` for exactly the duration of a theme transition (`useViewTransitionTheme`), so the
 * paired rule in `styles/tokens.css` can exclude any OTHER element's own permanent
 * `view-transition-name` (`PageTransition`'s `devon-page`, always set once the browser supports the
 * API -- see that file) from this transition's snapshot. Without it, `document.startViewTransition()`
 * being unscoped ("root") still sweeps up every named element in the document as its OWN separate
 * transition group; `devon-page` carries a real crossfade+slide animation
 * (`::view-transition-old/new(devon-page)`), so that animation played *underneath* the theme's
 * circular reveal at the same time -- the literal cause of the "greeting printed twice mid-transition"
 * defect (UI-OVERHAUL.md's "no double exposure -- circular reveal only where View Transitions
 * exist"). */
export const THEME_TRANSITION_CLASS = 'devon-theme-transition'

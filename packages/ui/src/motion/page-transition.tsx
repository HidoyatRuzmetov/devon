import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { RISE_PX, tweenPage, crossfade } from './tokens.js'
import { PAGE_VIEW_TRANSITION_NAME, supportsViewTransitions } from './view-transition.js'

export interface PageTransitionProps {
  /** Changes on every navigation -- the route path is the natural value. */
  routeKey: string
  children: React.ReactNode
  className?: string
}

/** UI-OVERHAUL.md §3 row 1: "View Transitions crossfade + 8 px slide (feature-detected),
 * AnimatePresence fallback".
 *
 * Where the browser has View Transitions, the *browser* animates the swap (the router calls
 * `startViewTransition()` around its own state update and the pair of `::view-transition-*`
 * animations in `styles/tokens.css` does the rest) -- so this component must NOT also mount an
 * `AnimatePresence` there, or the same page would animate twice, once per mechanism. It renders a
 * plain container carrying the `view-transition-name` instead. Everywhere else it falls back to
 * `AnimatePresence mode="wait"`, keyed on the route.
 *
 * Reduced motion: `startViewTransition()` already declines to start one, and the fallback below
 * drops the 8 px slide and keeps the crossfade -- feedback replaced, never deleted (DESIGN.md §2.5).
 */
export function PageTransition({
  routeKey,
  children,
  className,
}: PageTransitionProps): React.JSX.Element {
  const reduced = useReducedMotion()
  // Read once: a browser does not gain or lose the API mid-session, and re-reading per render would
  // make the first client render disagree with the second under React strict mode.
  const [native] = React.useState(supportsViewTransitions)

  if (native) {
    return (
      // `data-devon-page-transition` is the hook `styles/tokens.css`'s
      // `.devon-theme-transition [data-devon-page-transition]` rule targets to null out this
      // element's own `view-transition-name` for the duration of an unrelated (theme) transition --
      // see THEME_TRANSITION_CLASS's doc comment in `view-transition.ts`.
      <div
        className={className}
        data-devon-page-transition
        style={{ viewTransitionName: PAGE_VIEW_TRANSITION_NAME }}
      >
        {children}
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        className={cn(className)}
        initial={{ opacity: 0, y: reduced ? 0 : RISE_PX }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduced ? 0 : -RISE_PX / 2 }}
        transition={reduced ? crossfade : tweenPage}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

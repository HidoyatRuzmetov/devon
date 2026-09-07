/** The motion catalogue's numeric contract, in JS (DESIGN.md §2.5 / UI-OVERHAUL.md §3).
 *
 * `styles/tokens.css` carries the same durations and eases as CSS custom properties for the
 * pure-CSS transitions (hover fills, focus rings, Radix `data-state` keyframes). Everything driven
 * by `motion` (motion.dev) reads *these* constants instead, because a spring's physics cannot be
 * expressed as a CSS value and because a `motion` `transition` object wants seconds, not a `220ms`
 * string. The two must never drift: every number below traces to a DESIGN.md §2.5 row.
 */
import {
  DUR_MICRO,
  DUR_STANDARD,
  DUR_PAGE,
  DUR_CELEBRATION,
  EASE_OUT,
  EASE_IN,
  EASE_STANDARD,
  EASE_EMPHASIZED,
  springSettle,
  springSheet,
  springDrag,
} from '../lib/motion-tokens.js'

export {
  DUR_MICRO,
  DUR_STANDARD,
  DUR_PAGE,
  DUR_CELEBRATION,
  EASE_OUT,
  EASE_IN,
  EASE_STANDARD,
  EASE_EMPHASIZED,
  springSettle,
  springSheet,
  springDrag,
}

/** Milliseconds → seconds, the unit every `motion` transition wants. */
export const sec = (ms: number): number => ms / 1000

export const S_MICRO = sec(DUR_MICRO)
export const S_STANDARD = sec(DUR_STANDARD)
export const S_PAGE = sec(DUR_PAGE)
export const S_CELEBRATION = sec(DUR_CELEBRATION)

/** UI-OVERHAUL.md §3 "Lists, grids, tiles": 24 ms between children, fade + rise 8 px. */
export const STAGGER_STEP = 0.024
/** The single rise distance the whole catalogue uses -- lists, tiles, popovers, page transitions. */
export const RISE_PX = 8
/** Hover cards open after a beat so a passing pointer never flashes one (UI-OVERHAUL.md §3). */
export const HOVER_CARD_DELAY_MS = 150

/** A plain tween, written the way `motion`'s `transition` prop wants it. Named per DESIGN.md's own
 * ease tokens so a reviewer can grep `--ease-out` and find both halves of the system. */
export const tweenOut = { duration: S_STANDARD, ease: EASE_OUT } as const
export const tweenIn = { duration: S_MICRO, ease: EASE_IN } as const
export const tweenMicro = { duration: S_MICRO, ease: EASE_OUT } as const
export const tweenStandard = { duration: S_STANDARD, ease: EASE_STANDARD } as const
export const tweenPage = { duration: S_PAGE, ease: EASE_EMPHASIZED } as const

/** Reduced motion never deletes feedback (DESIGN.md §2.5) -- it replaces the tween with a crossfade
 * short enough to read as "instant, but something changed". */
export const crossfade = { duration: S_MICRO, ease: EASE_STANDARD } as const

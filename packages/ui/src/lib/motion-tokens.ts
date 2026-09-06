/** DESIGN.md §2.5 spring definitions for the `motion` (motion.dev) library. A spring's physics
 * parameters cannot be expressed as a CSS custom property, so -- unlike the duration/easing tokens
 * in `styles/tokens.css` -- these live in JS. Duration/easing constants are re-exported here too so a
 * component that mixes CSS transitions and `motion` animations has one import, not two. */
export const DUR_MICRO = 140
export const DUR_STANDARD = 220
export const DUR_PAGE = 300
export const DUR_CELEBRATION = 480

export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_IN = [0.7, 0, 0.84, 0] as const
export const EASE_STANDARD = [0.4, 0, 0.2, 1] as const
export const EASE_EMPHASIZED = [0.2, 0, 0, 1] as const

export const springSettle = { type: 'spring', visualDuration: 0.3, bounce: 0 } as const
export const springSheet = { type: 'spring', visualDuration: 0.35, bounce: 0.05 } as const
export const springDrag = { type: 'spring', stiffness: 500, damping: 40, mass: 1 } as const

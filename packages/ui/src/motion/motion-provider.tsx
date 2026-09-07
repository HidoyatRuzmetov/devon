import * as React from 'react'
import { MotionConfig } from 'motion/react'

export interface MotionProviderProps {
  children: React.ReactNode
}

/** Mounted once, above the whole app (`apps/web/src/app.tsx`). `reducedMotion="user"` makes every
 * `motion` component in the tree drop transforms and opacity-only-crossfade when the OS asks for
 * reduced motion -- the library-level half of DESIGN.md §2.5's "replace, never delete". The
 * component-level half is `useReducedMotion()`, which each piece in this folder reads itself so it
 * can substitute a *designed* replacement (a crossfade, a static illustration, an instant height
 * change) rather than leaving a bare jump-cut. */
export function MotionProvider({ children }: MotionProviderProps): React.JSX.Element {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

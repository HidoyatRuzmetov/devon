import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { tweenOut, tweenIn, crossfade } from './tokens.js'

export interface CollapsibleProps {
  open: boolean
  children: React.ReactNode
  className?: string
  /** Rendered as `aria-hidden` content is removed from the tree on close; pass an id so the trigger
   * can point `aria-controls` at it. */
  id?: string
}

/** UI-OVERHAUL.md §3 "Collapsibles, accordions": height auto animation at `--dur-enter`.
 * `height: 'auto'` is a real animated value in `motion` (it measures, then animates the pixel
 * height, then releases) -- the reason this exists as a primitive rather than a CSS `max-height`
 * guess per screen. Reduced motion crossfades the block in and out at its natural height. */
export function Collapsible({
  open,
  children,
  className,
  id,
}: CollapsibleProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          id={id}
          className={className}
          style={{ overflow: 'hidden' }}
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={reduced ? crossfade : { ...tweenOut, opacity: tweenIn }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

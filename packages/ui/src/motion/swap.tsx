import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { tweenOut, crossfade } from './tokens.js'

export interface SwapProps {
  /** `true` while the skeleton should show. */
  pending: boolean
  /** The layout-matched skeleton. */
  fallback: React.ReactNode
  children: React.ReactNode
  className?: string
}

/** The half of "skeleton → content" that no skeleton can do on its own. `<Skeleton>` shimmers and
 * `<Skeleton>` disappears; what the catalogue asks for is the *crossfade between them, with no
 * layout jump*, and a caller writing `pending ? <Skeleton/> : <Content/>` gets neither — the
 * skeleton is gone on the frame the content mounts, and if the two differ by a pixel the whole page
 * hops.
 *
 * Both children are stacked in the same CSS grid cell, so the box is always as tall as the taller of
 * the two and nothing below it moves while they trade places. Only `opacity` animates.
 *
 * The skeleton keeps `pointer-events: none` and `aria-hidden` on its way out so a click landing
 * during the 220 ms crossfade reaches the real content underneath, not the ghost on top of it.
 *
 * Reduced motion shortens the crossfade to `--dur-micro`: the swap still reads as a swap rather than
 * a cut, without anything lingering. */
export function Swap({ pending, fallback, children, className }: SwapProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const transition = reduced ? crossfade : tweenOut

  return (
    <div className={cn('grid', className)}>
      <motion.div
        className="col-start-1 row-start-1"
        aria-hidden={pending ? undefined : true}
        animate={{ opacity: pending ? 1 : 0 }}
        initial={false}
        transition={transition}
        style={{ pointerEvents: pending ? 'auto' : 'none' }}
      >
        {fallback}
      </motion.div>
      <motion.div
        className="col-start-1 row-start-1"
        aria-hidden={pending ? true : undefined}
        animate={{ opacity: pending ? 0 : 1 }}
        initial={false}
        transition={transition}
        style={{ pointerEvents: pending ? 'none' : 'auto' }}
      >
        {children}
      </motion.div>
    </div>
  )
}

import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
 * skeleton is gone on the frame the content mounts, so for one frame the box has nothing in it at
 * all and everything below it jumps up and back.
 *
 * Both layers live in the same CSS grid cell, so while they are trading places the box is as tall as
 * the taller of the two and nothing below it moves. Only `opacity` animates. The skeleton then
 * *unmounts* when its fade finishes (`AnimatePresence`), so a screen whose real content is shorter
 * than its skeleton settles to the real height instead of holding a permanent gap the size of the
 * thing that was loading.
 *
 * The skeleton keeps `pointer-events: none` and `aria-hidden` on its way out, so a click landing
 * during the 220 ms crossfade reaches the real content underneath rather than the ghost on top.
 *
 * Reduced motion shortens the crossfade to `--dur-micro`: the swap still reads as a swap rather than
 * a cut, without anything lingering. */
export function Swap({ pending, fallback, children, className }: SwapProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const transition = reduced ? crossfade : tweenOut

  return (
    <div className={cn('grid', className)}>
      <AnimatePresence initial={false}>
        {pending ? (
          <motion.div
            key="devon-swap-fallback"
            className="col-start-1 row-start-1 self-start"
            aria-hidden="true"
            style={{ pointerEvents: 'none' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            {fallback}
          </motion.div>
        ) : null}
      </AnimatePresence>
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

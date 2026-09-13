import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { S_STANDARD, EASE_STANDARD } from './tokens.js'

export interface ShakeProps {
  /** Flip to `true` for one frame to fire one refusal; the component calls `onDone` when it ends so
   * the caller can flip it back (the same contract `<Celebrate>` uses). */
  play: boolean
  onDone?: () => void
  children: React.ReactNode
  className?: string
  /** Peak travel in pixels. 4 px is the product default: enough to read as "no", small enough that
   * nothing around it appears to move. */
  distance?: number
}

/** The catalogue's *refusal*, and the counterpart to `<Celebrate>`: the product says yes with a
 * 12-particle burst and no with this. Three surfaces use it — an invalid drop on the board, a
 * failed optimistic write rolling back, and a field whose inline validation just rejected what was
 * typed — and they all mean the same thing, so they all move the same way.
 *
 * Transform-only (`x`), so a shake inside a 200-card board column composites on the GPU and never
 * reflows its siblings.
 *
 * **Reduced motion replaces the travel with a destructive-tinted ring that fades out in place.**
 * The refusal is still unmistakable, nothing moves. (DESIGN.md §2.5: replace, never delete.) */
export function Shake({
  play,
  onDone,
  children,
  className,
  distance = 4,
}: ShakeProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const handleComplete = React.useCallback(() => onDone?.(), [onDone])

  if (reduced) {
    return (
      <div className={cn('relative', className)}>
        {children}
        {play ? (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-destructive"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: S_STANDARD, ease: EASE_STANDARD }}
            onAnimationComplete={handleComplete}
          />
        ) : null}
      </div>
    )
  }

  return (
    <motion.div
      className={className}
      animate={
        play ? { x: [0, -distance, distance, -distance * 0.6, distance * 0.6, 0] } : { x: 0 }
      }
      transition={play ? { duration: S_STANDARD, ease: EASE_STANDARD } : { duration: 0 }}
      // `exactOptionalPropertyTypes` refuses a possibly-`undefined` handler prop, so the handler is
      // always defined and decides for itself whether this completion was a shake ending.
      onAnimationComplete={() => {
        if (play) handleComplete()
      }}
    >
      {children}
    </motion.div>
  )
}

/** The state machine every caller of `<Shake>` would otherwise write, mirroring `useCelebrate()`:
 * `fire()` plays one refusal, the component resets when it ends. */
export function useShake(): { play: boolean; fire: () => void; onDone: () => void } {
  const [play, setPlay] = React.useState(false)
  return {
    play,
    // Re-firing while one is already playing has to restart it, otherwise a second rejected drop in
    // a row is silent: drop to `false` for a frame, then back up.
    fire: React.useCallback(() => {
      setPlay(false)
      requestAnimationFrame(() => setPlay(true))
    }, []),
    onDone: React.useCallback(() => setPlay(false), []),
  }
}

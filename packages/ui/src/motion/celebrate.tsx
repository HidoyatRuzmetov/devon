import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { S_CELEBRATION, EASE_OUT } from './tokens.js'

export interface CelebrateProps {
  /** Flip to `true` for one frame to fire the burst; the component resets itself when the animation
   * finishes and calls `onDone` (if given) so the caller can flip it back. */
  play: boolean
  onDone?: () => void
  className?: string
  /** Coin-sized by design -- DESIGN.md §2.5 refuses "confetti beyond a coin-sized 12-particle burst
   * from the checkbox itself". Radius in pixels the particles travel. */
  radius?: number
}

const PARTICLE_COUNT = 12
/** Fixed hues from the token set (never a random colour): success, attention, primary, info. */
const PARTICLE_COLORS = [
  'var(--color-success)',
  'var(--color-attention)',
  'var(--color-primary)',
  'var(--color-info)',
] as const

/** UI-OVERHAUL.md §3 "Checkbox / task done" and "RSVP yes, card done, sprint complete": a
 * 12-particle burst from the element itself, one shot, `--dur-celebration`.
 *
 * Absolutely positioned and pointer-transparent: drop it inside any `relative` parent (a checkbox
 * box, an RSVP button) and the burst radiates from that parent's centre.
 *
 * Reduced motion replaces the burst with a single ring that fades out in place -- the moment is
 * still marked, nothing flies. */
export function Celebrate({
  play,
  onDone,
  className,
  radius = 22,
}: CelebrateProps): React.JSX.Element {
  const reduced = useReducedMotion()
  // `motion` hands the finished animation's definition to this callback; `onDone` takes no
  // arguments, so it is wrapped rather than passed through (and `exactOptionalPropertyTypes` refuses
  // a possibly-`undefined` handler prop, hence the always-defined wrapper).
  const handleComplete = React.useCallback(() => onDone?.(), [onDone])

  return (
    <span
      aria-hidden="true"
      className={cn('pointer-events-none absolute left-1/2 top-1/2 z-10 size-0', className)}
    >
      <AnimatePresence>
        {play ? (
          reduced ? (
            <motion.span
              key="ring"
              className="absolute -left-4 -top-4 block size-8 rounded-full border-2 border-success"
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: S_CELEBRATION, ease: EASE_OUT }}
              onAnimationComplete={handleComplete}
            />
          ) : (
            <>
              {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
                const angle = (i / PARTICLE_COUNT) * Math.PI * 2
                const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length]
                return (
                  <motion.span
                    key={i}
                    className="absolute block size-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                    initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
                    animate={{
                      x: Math.cos(angle) * radius,
                      y: Math.sin(angle) * radius,
                      opacity: 0,
                      scale: 1,
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: S_CELEBRATION, ease: EASE_OUT }}
                    {...(i === 0 ? { onAnimationComplete: handleComplete } : {})}
                  />
                )
              })}
            </>
          )
        ) : null}
      </AnimatePresence>
    </span>
  )
}

/** The tiny state machine every caller of `<Celebrate>` would otherwise write: `fire()` starts one
 * burst, the component resets when it ends. */
export function useCelebrate(): { play: boolean; fire: () => void; onDone: () => void } {
  const [play, setPlay] = React.useState(false)
  return {
    play,
    fire: React.useCallback(() => setPlay(true), []),
    onDone: React.useCallback(() => setPlay(false), []),
  }
}

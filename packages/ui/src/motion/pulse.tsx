import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { S_CELEBRATION, EASE_OUT } from './tokens.js'

const TONE_RING = {
  success: 'ring-success',
  primary: 'ring-primary',
  attention: 'ring-attention',
} as const

export interface SettlePulseProps {
  /** Flip to `true` for one frame; `onDone` fires when the pulse ends. */
  play: boolean
  onDone?: () => void
  className?: string
  tone?: keyof typeof TONE_RING
}

/** The quieter half of "a card is done": the tile settles into its new column and **one** soft ring
 * expands out of its own edge and fades. Deliberately not the 12-particle burst — a card moving to
 * Done on someone else's board is a fact, not a party; the burst belongs to the person who ticked
 * the box (DESIGN.md §2.5 keeps the loud one for the element that was acted on).
 *
 * Absolutely positioned and pointer-transparent: drop it inside any `relative` parent.
 *
 * Reduced motion replaces the expansion with a ring that simply fades in and out at the tile's own
 * size — still a mark on the moment, with nothing growing. */
export function SettlePulse({
  play,
  onDone,
  className,
  tone = 'success',
}: SettlePulseProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const handleComplete = React.useCallback(() => onDone?.(), [onDone])

  return (
    <AnimatePresence>
      {play ? (
        <motion.span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 rounded-md ring-2',
            TONE_RING[tone],
            className,
          )}
          initial={reduced ? { opacity: 0 } : { opacity: 0.7, scale: 1 }}
          animate={reduced ? { opacity: [0, 0.7, 0] } : { opacity: 0, scale: 1.04 }}
          exit={{ opacity: 0 }}
          transition={{ duration: S_CELEBRATION, ease: EASE_OUT }}
          onAnimationComplete={handleComplete}
        />
      ) : null}
    </AnimatePresence>
  )
}

/** `useCelebrate()`'s quieter sibling, same contract. */
export function useSettlePulse(): { play: boolean; fire: () => void; onDone: () => void } {
  const [play, setPlay] = React.useState(false)
  return {
    play,
    fire: React.useCallback(() => {
      setPlay(false)
      requestAnimationFrame(() => setPlay(true))
    }, []),
    onDone: React.useCallback(() => setPlay(false), []),
  }
}

export interface LivePulseProps {
  /** Accessible name — a bare dot means nothing to a screen reader, and this one is usually the
   * only sign that somebody else is typing into the thing you are reading. */
  label: string
  className?: string
  tone?: keyof typeof TONE_RING
}

/** "Somebody is editing this right now." The one deliberately *looping* animation in the product
 * outside the ambient gradient and the empty-state float, and it earns the loop the same way a
 * blinking cursor does: it is reporting a live fact, and it stops the moment the fact stops (the
 * caller unmounts it).
 *
 * Two-second breath, opacity and scale only, on a 6 px dot — small enough that it never competes
 * with the content it sits beside.
 *
 * Reduced motion replaces the breath with a steady, fully-opaque dot: the fact is still stated, it
 * just does not move. */
export function LivePulse({
  label,
  className,
  tone = 'primary',
}: LivePulseProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const dotTone =
    tone === 'success' ? 'bg-success' : tone === 'attention' ? 'bg-attention' : 'bg-primary'

  return (
    <span
      className={cn('relative inline-flex size-1.5 shrink-0', className)}
      role="status"
      aria-label={label}
    >
      {reduced ? null : (
        <motion.span
          aria-hidden="true"
          className={cn('absolute inset-0 rounded-full', dotTone)}
          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 2.2, 1] }}
          transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
        />
      )}
      <span aria-hidden="true" className={cn('relative size-1.5 rounded-full', dotTone)} />
    </span>
  )
}

import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { S_STANDARD, EASE_STANDARD } from './tokens.js'

export interface ShakeProps {
  /** Flip to `true` for one frame to fire one refusal; the component calls `onDone` when the
   * animation ends so the caller can flip it back (the same contract `<Celebrate>` uses). */
  play: boolean
  onDone?: () => void
  children: React.ReactNode
  className?: string
}

/** The catalogue's *refusal*, and the counterpart to `<Celebrate>`: the product says yes with a
 * 12-particle burst and no with this. Four surfaces use it — an invalid drop on the board, a failed
 * optimistic write rolling back, a field whose inline validation just rejected what was typed, and a
 * login/register/join submission the server turned down — and they all mean the same thing, so they
 * all move the same way.
 *
 * **The wag is a CSS keyframe (`devon-shake` in `styles/tokens.css`), not a `motion` animation**, and
 * that is a measured decision rather than a stylistic one. `<Shake>` wraps things that exist in
 * quantity: every tile on a 540-card board is a potential rollback, so every tile carries one. A
 * `motion` component pays its layout bookkeeping on every render whether or not it is animating; a
 * keyframe costs nothing at all until the class lands on the element. Transform-only either way, so
 * the wag itself composites on the GPU and never reflows a sibling.
 *
 * **Reduced motion replaces the travel with a destructive-tinted ring that fades out in place.** Note
 * that it *replaces* rather than relies on the global `prefers-reduced-motion` backstop in
 * `tokens.css` — that backstop would collapse the keyframe to nothing, leaving a refusal with no
 * feedback at all, which is exactly what DESIGN.md §2.5 forbids. */
export function Shake({ play, onDone, children, className }: ShakeProps): React.JSX.Element {
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
    <div
      className={cn(className, play && 'devon-shake')}
      // The keyframe runs twice; `onAnimationEnd` fires once at the end of the whole run.
      onAnimationEnd={(event) => {
        if (play && event.animationName.includes('devon-shake')) handleComplete()
      }}
    >
      {children}
    </div>
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

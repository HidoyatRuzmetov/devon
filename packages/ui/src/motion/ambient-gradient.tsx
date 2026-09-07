import * as React from 'react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface AmbientGradientProps {
  className?: string
  /** `auth` is the two-blob navy/amber wash behind the sign-in card; `hub` is the wider, flatter
   * version behind the Home greeting and the departments hub. */
  variant?: 'auth' | 'hub'
}

/** DESIGN.md v2 (raised from "no animated backgrounds"): **ambient gradients only on auth and the
 * hub screens**, always reduced-motion safe.
 *
 * Two soft radial washes built from `--color-primary` / `--color-attention` at low alpha, drifting
 * on a 24 s loop -- slow enough that it never reads as movement in peripheral vision, which is the
 * line between "ambient" and "distraction". Pure CSS (`devon-ambient-drift` in `styles/tokens.css`),
 * `aria-hidden`, pointer-transparent, and completely static under `prefers-reduced-motion`: the
 * gradient stays, the drift stops. */
export function AmbientGradient({
  className,
  variant = 'auth',
}: AmbientGradientProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}
    >
      <span
        className={cn(
          'absolute block rounded-full blur-3xl',
          variant === 'auth'
            ? '-left-30 -top-40 size-140 bg-primary/12'
            : '-left-40 -top-50 h-100 w-200 bg-primary/10',
          !reduced && 'devon-ambient-drift',
        )}
      />
      <span
        className={cn(
          'absolute block rounded-full blur-3xl',
          variant === 'auth'
            ? '-bottom-45 -right-25 size-120 bg-attention/12'
            : '-bottom-40 -right-40 h-90 w-180 bg-attention/10',
          !reduced && 'devon-ambient-drift devon-ambient-drift-slow',
        )}
      />
    </div>
  )
}

export interface IdleFloatProps {
  children: React.ReactNode
  className?: string
}

/** UI-OVERHAUL.md §3 "Empty states": the illustration floats on a 4 s loop, and stops entirely under
 * reduced motion. CSS keyframe rather than a `motion` loop -- an empty state should not keep a
 * JS animation frame alive for as long as it is on screen. */
export function IdleFloat({ children, className }: IdleFloatProps): React.JSX.Element {
  const reduced = useReducedMotion()
  return <div className={cn(!reduced && 'devon-idle-float', className)}>{children}</div>
}

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
          'absolute block rounded-full',
          variant === 'auth'
            ? '-left-40 -top-50 size-160 bg-primary/10 blur-[90px]'
            : '-left-1/4 -top-100 h-160 w-[150%] bg-primary/6 blur-[110px]',
          !reduced && 'devon-ambient-drift',
        )}
      />
      <span
        className={cn(
          'absolute block rounded-full',
          variant === 'auth'
            ? '-bottom-50 -right-35 size-140 bg-attention/10 blur-[90px]'
            : '-right-1/4 -top-80 h-140 w-[120%] bg-attention/6 blur-[110px]',
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

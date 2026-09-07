import * as React from 'react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface AmbientGradientProps {
  className?: string
  /** `auth` is the two-corner wash behind the sign-in card; `hub` is the wider, flatter version
   * behind the Home greeting and the departments hub. */
  variant?: 'auth' | 'hub'
}

/** DESIGN.md v2 §2.6 (raised from v1's "no animated backgrounds"): **ambient gradients only on auth
 * and the hub screens**, always reduced-motion safe.
 *
 * Built from CSS radial gradients rather than blurred blocks. A blurred `<span>` has edges, and this
 * layer is `overflow-hidden` inside whatever container it sits in -- so on Home, where the container
 * is the 1280 px content column, a blurred blob was being sliced into a visible grey rectangle
 * behind the greeting (seen booting the demo, 2026-09-07). A radial gradient fades to fully
 * transparent well inside its own box, so it cannot produce an edge no matter where it is clipped.
 *
 * Both layers are `aria-hidden`, pointer-transparent, and completely static under
 * `prefers-reduced-motion`: the gradient stays, the 24 s drift stops. If the wash is ever noticeable
 * as movement in peripheral vision it is too strong -- turn it down, it is not a feature. */
export function AmbientGradient({
  className,
  variant = 'auth',
}: AmbientGradientProps): React.JSX.Element {
  const reduced = useReducedMotion()

  const primary =
    variant === 'auth'
      ? 'radial-gradient(60% 55% at 18% 12%, color-mix(in oklch, var(--color-ambient-1) 22%, transparent) 0%, transparent 70%)'
      : 'radial-gradient(70% 60% at 12% 0%, color-mix(in oklch, var(--color-ambient-1) 14%, transparent) 0%, transparent 68%)'
  const accent =
    variant === 'auth'
      ? 'radial-gradient(55% 50% at 84% 82%, color-mix(in oklch, var(--color-ambient-2) 20%, transparent) 0%, transparent 70%)'
      : 'radial-gradient(60% 55% at 92% 4%, color-mix(in oklch, var(--color-ambient-2) 12%, transparent) 0%, transparent 68%)'

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)}
    >
      <span
        className={cn('absolute inset-0 block', !reduced && 'devon-ambient-drift')}
        style={{ backgroundImage: primary }}
      />
      <span
        className={cn(
          'absolute inset-0 block',
          !reduced && 'devon-ambient-drift devon-ambient-drift-slow',
        )}
        style={{ backgroundImage: accent }}
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

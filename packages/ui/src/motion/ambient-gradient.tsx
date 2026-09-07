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

  // `calc(N% * var(--ambient-alpha-scale))`, not a bare `N%`: dark theme's ambient colours are much
  // lighter than light theme's, so the same mix strength reads as a visible panel rather than a wash
  // there -- `--ambient-alpha-scale` (tokens.css) drops it another step under `[data-theme='dark']`.
  const primary =
    variant === 'auth'
      ? 'radial-gradient(60% 55% at 18% 12%, color-mix(in oklch, var(--color-ambient-1) calc(22% * var(--ambient-alpha-scale)), transparent) 0%, transparent 70%)'
      : 'radial-gradient(70% 60% at 12% 0%, color-mix(in oklch, var(--color-ambient-1) calc(14% * var(--ambient-alpha-scale)), transparent) 0%, transparent 68%)'
  const accent =
    variant === 'auth'
      ? 'radial-gradient(55% 50% at 84% 82%, color-mix(in oklch, var(--color-ambient-2) calc(20% * var(--ambient-alpha-scale)), transparent) 0%, transparent 70%)'
      : 'radial-gradient(60% 55% at 92% 4%, color-mix(in oklch, var(--color-ambient-2) calc(12% * var(--ambient-alpha-scale)), transparent) 0%, transparent 68%)'

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

/** The "hub" variant's own fix for a real bug: `AmbientGradient` is `absolute inset-0`, sized to
 * its nearest positioned ancestor -- on Home and the departments hub that used to be a `relative`
 * wrapper spanning the *entire* content column (greeting + the whole dashboard/member list below
 * it), often well over a thousand pixels tall. Radial-gradient percentages are relative to that box,
 * so the wash silently grew to cover most of the page, and wherever the first opaque `Card` began
 * (right under a section heading) cut it off mid-fade -- exactly the hard edge DESIGN.md v2 §2.6
 * refuses ("must never be noticeable as an edge"), and in dark mode the oversized, uncut portion read
 * as a stray lighter panel rather than a wash.
 *
 * This bounds the wash to a fixed height near the top of the page instead: short enough that both
 * radial layers reach their own `transparent` stop safely inside the box (their `~68-70%` radius
 * point lands well short of it), so nothing ever needs `overflow-hidden` to crop a visible edge --
 * the gradient has already finished fading on its own by the time the box ends. Still positioned
 * `absolute inset-x-0 top-0` against the page-level container (not the greeting block specifically),
 * so it reads as a backdrop behind the whole column rather than being welded to one child's height. */
export function HubAmbientWash({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 h-160 overflow-hidden',
        className,
      )}
    >
      <AmbientGradient variant="hub" />
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

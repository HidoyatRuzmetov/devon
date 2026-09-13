import * as React from 'react'
import { motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { tweenStandard, crossfade } from './tokens.js'

export interface ProgressRingProps {
  /** 0–100. Values outside the range are clamped rather than drawn as an over-full ring. */
  value: number
  /** Outer diameter in px. */
  size?: number
  strokeWidth?: number
  /** Accessible name, e.g. `t('projects.progress.aria')`. Required: a bare ring means nothing to a
   * screen reader. */
  label: string
  /** Rendered in the middle (a percentage, a fraction, a Pomodoro clock). */
  children?: React.ReactNode
  className?: string
  /** Token class for the arc, e.g. `text-success`. The track is always `--color-muted`. Changing it
   * crossfades rather than cuts (see `sweep`). */
  toneClassName?: string
  /** How the arc travels to a new value.
   *
   * `'settle'` (the default) is the catalogue's `--ease-standard` tween: right for a value that
   * jumps -- a sprint gaining a finished task, a project's completion moving from 40 % to 55 %.
   *
   * `'tick'` is a *linear one-second* sweep, for the one surface whose value changes every second:
   * the Pomodoro ring (DESIGN.md §10, "Pomodoro | Animated ring stroke ... 1 s per tick"). With the
   * default tween that ring lurched -- 220 ms of easing followed by 780 ms of nothing, once a
   * second, for twenty-five minutes. Linear over exactly the tick interval makes it a second hand.
   *
   * Reduced motion collapses both to a crossfade; a clock that sweeps is still a clock that reads. */
  sweep?: 'settle' | 'tick'
}

/** UI-OVERHAUL.md §3: project progress rings, the Pomodoro ring, sprint completion. The arc animates
 * its own length whenever `value` changes -- under reduced motion it snaps and crossfades instead
 * (the number in the middle is the feedback that survives). round3: the very first mount now sweeps
 * in from empty (`initial` only ever applies once, at mount, never on a later value change) instead
 * of simply appearing already full -- the sprint/project rings this was named for get it for free
 * since they all render through this one primitive. */
export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  label,
  children,
  className,
  toneClassName = 'text-primary',
  sweep = 'settle',
}: ProgressRingProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const clamped = Math.max(0, Math.min(100, value))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="text-muted"
          stroke="currentColor"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          // The arc's colour is a token class, and a class swap is a cut. The Pomodoro ring changes
          // colour every time a phase ends (focus -> break -> focus), and a cut there reads as a
          // glitch rather than as a change of state -- so the stroke colour transitions over
          // `--dur-standard` (0 ms under reduced motion, via the backstop in `tokens.css`).
          className={cn(
            'transition-[stroke] duration-(--dur-standard) ease-(--ease-standard)',
            toneClassName,
          )}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={circumference}
          initial={
            reduced
              ? { strokeDashoffset: circumference * (1 - clamped / 100) }
              : { strokeDashoffset: circumference }
          }
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={
            reduced ? crossfade : sweep === 'tick' ? { duration: 1, ease: 'linear' } : tweenStandard
          }
        />
      </svg>
      {children ? (
        <span className="absolute inset-0 flex items-center justify-center text-caption tabular-nums text-foreground">
          {children}
        </span>
      ) : null}
    </div>
  )
}

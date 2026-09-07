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
  /** Token class for the arc, e.g. `text-success`. The track is always `--color-muted`. */
  toneClassName?: string
}

/** UI-OVERHAUL.md §3: project progress rings, the Pomodoro ring, sprint completion. The arc animates
 * its own length whenever `value` changes -- under reduced motion it snaps and crossfades instead
 * (the number in the middle is the feedback that survives). */
export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  label,
  children,
  className,
  toneClassName = 'text-primary',
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
          className={toneClassName}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={reduced ? crossfade : tweenStandard}
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

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '../lib/cn.js'

export interface ProgressProps extends Omit<
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
  'value'
> {
  /** 0–100. Clamped rather than allowed to overflow its own track. */
  value: number
  /** Accessible name -- a bare bar tells a screen reader nothing. */
  label: string
  tone?: 'primary' | 'success' | 'warning' | 'destructive' | 'attention'
  size?: 'sm' | 'md'
}

const TONE_CLASS = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  attention: 'bg-attention',
} as const

const SIZE_CLASS = { sm: 'h-1', md: 'h-2' } as const

/** DESIGN.md §3 primitive; the linear sibling of `ProgressRing`. Use the bar for "how far through a
 * process" (an upload, a capacity meter, a checklist fraction) and the ring for a *number the user
 * reads* (project progress, sprint completion, the Pomodoro clock).
 *
 * The fill transitions on `--ease-standard` -- an in-place change of an existing value, per
 * DESIGN.md §2.5's mapping, not an entrance. */
export const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, label, tone = 'primary', size = 'md', ...props }, ref) => {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={clamped}
      aria-label={label}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-muted',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'size-full transition-transform duration-(--dur-standard) ease-(--ease-standard)',
          TONE_CLASS[tone],
        )}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = 'Progress'

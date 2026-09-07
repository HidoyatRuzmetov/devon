import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'

export interface SparkleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only affordance with no accessible name is not an affordance. */
  'aria-label': string
  /** Renders the label next to the icon (a wide toolbar); omit for the icon-only form used beside
   * an input. */
  label?: string
  size?: 'sm' | 'md'
  loading?: boolean
}

/** UI-OVERHAUL.md §2 "AI helpers": "Sparkle button near the input; preview in a panel with
 * Accept / Edit / Discard; never auto-applies" -- the convention from Notion AI, Linear AI and
 * Copilot previews, so a civil servant recognises what it does before pressing it.
 *
 * The shimmer is a slow sweep across the icon on hover/focus only -- never idle. An AI affordance
 * that glitters at rest reads as an advertisement; one that responds when you reach for it reads as
 * a capability. Reduced motion drops the sweep and keeps the colour shift. */
export const SparkleButton = React.forwardRef<HTMLButtonElement, SparkleButtonProps>(
  ({ className, label, size = 'md', loading = false, disabled, ...props }, ref) => {
    const reduced = useReducedMotion()
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled ?? loading}
        aria-busy={loading || undefined}
        className={cn(
          'group relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-sm border border-border',
          'bg-card text-primary transition-colors duration-(--dur-micro) ease-out',
          'hover:border-primary/50 hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50',
          label
            ? size === 'sm'
              ? 'h-9 px-3 text-small'
              : 'h-10 px-4 text-body'
            : size === 'sm'
              ? 'size-9 justify-center'
              : 'size-10 justify-center',
          className,
        )}
        {...props}
      >
        <Sparkles
          className={cn(
            'size-4 shrink-0 transition-transform duration-(--dur-standard) ease-out',
            !reduced && !loading && 'group-hover:rotate-12 group-focus-visible:rotate-12',
            loading && 'animate-pulse',
          )}
          aria-hidden="true"
        />
        {label ? <span className="min-w-0 truncate">{label}</span> : null}
        {reduced ? null : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full group-focus-visible:translate-x-full"
          />
        )}
      </button>
    )
  },
)
SparkleButton.displayName = 'SparkleButton'

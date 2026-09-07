import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'children'
> {
  options: readonly SelectOption[]
}

/** A bare styled native `<select>`, same tokens-only shape as `Input`. Promoted out of the `ai` and
 * `events` feature folders that each built this primitive independently -- the signal that it
 * belongs here rather than a third time. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground',
        'transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
)
Select.displayName = 'Select'

import * as React from 'react'
import { cn } from '../lib/cn.js'
import { FIELD_TRANSITION } from '../lib/focus-ring.js'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

/** A bare styled `<input>`. Labelling is the caller's job (`<label htmlFor>` or `aria-label`) --
 * this primitive never invents a placeholder-as-label pattern (WCAG 3.3.2 / I-12). */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground',
        'placeholder:text-muted-foreground',
        FIELD_TRANSITION,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

import * as React from 'react'
import { cn } from '../lib/cn.js'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

/** A bare styled `<textarea>`, same tokens-only shape as `Input`. Promoted out of three feature
 * folders (`ai`, `events`, `personal`) that each built this primitive independently -- the signal
 * that it belongs here rather than in a fourth. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground',
        'placeholder:text-muted-foreground',
        'transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

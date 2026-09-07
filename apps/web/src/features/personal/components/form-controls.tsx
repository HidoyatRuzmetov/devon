// A small local `Textarea` this feature needs that `@devon/ui` does not ship yet -- same tokens-only
// shape as `@devon/ui`'s `Input`, kept local rather than added to the shared package, exactly like
// `apps/web/src/features/ai/components/form-controls.tsx` and `features/events/components/
// form-controls.tsx` (this file mirrors those on purpose: three features independently needing the
// same primitive is the signal it eventually belongs in `@devon/ui`, not a reason to import across
// feature folders today -- noted for the merge).
import * as React from 'react'
import { cn } from '@devon/ui'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
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
))
Textarea.displayName = 'Textarea'

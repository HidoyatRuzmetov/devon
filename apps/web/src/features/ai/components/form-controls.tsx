// Minimal local form primitives this feature needs that `@devon/ui` does not ship yet (Textarea,
// Select, Checkbox) -- same tokens-only shape as `@devon/ui`'s `Input`, kept local rather than added
// to the shared package, exactly like `apps/web/src/features/events/components/form-controls.tsx`
// (this file mirrors that one on purpose: two features independently needing the same three small
// primitives is the signal that they eventually belong in `@devon/ui`, not a reason to import across
// feature folders today).
import * as React from 'react'
import { Check } from 'lucide-react'
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

export interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, id, disabled, className, ...aria }, ref) => (
    <button
      ref={ref}
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm border border-border',
        'transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
        className,
      )}
      {...aria}
    >
      {checked ? <Check className="size-3.5" aria-hidden="true" /> : null}
    </button>
  ),
)
Checkbox.displayName = 'Checkbox'

export function Field({
  label,
  htmlFor,
  children,
  hint,
  className,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
  hint?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-small font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

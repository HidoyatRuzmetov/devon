// Minimal local form primitives this feature needs that `@devon/ui` does not ship yet (Textarea,
// Select, Checkbox -- DESIGN.md §3 lists them as build-order items, not yet built). Tokens only, same
// visual language as `@devon/ui`'s `Input` (`packages/ui/src/primitives/input.tsx`) -- kept local
// rather than added to the shared package, which every other module-in-progress also touches.
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

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
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
}

/** A minimal checkbox (DESIGN.md's celebration burst is out of scope for a plain form control here
 * -- that belongs to the shared primitive once it exists). Fully keyboard-operable native
 * `<button role="checkbox">`, no hidden `<input>` needed since there is no form submission via
 * native `FormData` in this feature (every mutation goes through `apiClient`). */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, id, disabled, className }, ref) => (
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
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-small font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

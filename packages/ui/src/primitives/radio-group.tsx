import * as React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cn } from '../lib/cn.js'

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('flex flex-col gap-2', className)} {...props} />
))
RadioGroup.displayName = 'RadioGroup'

/** DESIGN.md §3 primitive. The dot scales in at `--dur-micro`; the ring is the shared focus token,
 * never a bespoke outline. */
export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card',
      'transition-colors duration-(--dur-micro) ease-out',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-primary',
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="block size-2.5 rounded-full bg-primary animate-[devon-scale-in_140ms_var(--ease-out)]" />
  </RadioGroupPrimitive.Item>
))
RadioGroupItem.displayName = 'RadioGroupItem'

export interface RadioOptionProps {
  value: string
  label: string
  description?: string
  disabled?: boolean
  className?: string
}

/** The row shape every settings screen wants: the control, a label that is itself the click target,
 * and an optional second line. Composed here once so no screen re-invents the `<label>` wiring. */
export function RadioOption({
  value,
  label,
  description,
  disabled,
  className,
}: RadioOptionProps): React.JSX.Element {
  const id = React.useId()
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RadioGroupItem
        value={value}
        id={id}
        {...(disabled === undefined ? {} : { disabled })}
        className="mt-0.5"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-body text-foreground">{label}</span>
        {description ? (
          <span className="block text-small text-muted-foreground">{description}</span>
        ) : null}
      </label>
    </div>
  )
}

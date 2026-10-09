import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Minus } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { AnimatedCheck } from '../motion/animated-check.js'
import { Celebrate } from '../motion/celebrate.js'

export interface CheckboxProps extends Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'asChild'
> {
  /** UI-OVERHAUL.md §3 "Checkbox / task done": the 12-particle burst fires from the box itself the
   * moment it becomes checked. Off for a filter checkbox or a settings toggle -- a celebration is
   * for *completing work*, never for ticking an option (DESIGN.md §2.5 keeps celebrations to two
   * moments). */
  celebrate?: boolean
  size?: 'sm' | 'md'
}

const SIZE_CLASS = { sm: 'size-4', md: 'size-5' } as const

/** DESIGN.md §3 primitive. The check *draws in* (`AnimatedCheck`), the indeterminate state is a
 * dash, and both are replaced by an instant appearance under reduced motion. */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(
  (
    {
      className,
      celebrate = false,
      size = 'md',
      checked,
      defaultChecked,
      onCheckedChange,
      ...props
    },
    ref,
  ) => {
    const [uncontrolled, setUncontrolled] = React.useState(defaultChecked ?? false)
    const value = checked ?? uncontrolled
    const isChecked = value === true
    const [burst, setBurst] = React.useState(false)
    const wasChecked = React.useRef(isChecked)

    React.useEffect(() => {
      if (celebrate && isChecked && !wasChecked.current) setBurst(true)
      wasChecked.current = isChecked
    }, [celebrate, isChecked])

    return (
      <CheckboxPrimitive.Root
        ref={ref}
        {...(checked === undefined ? {} : { checked })}
        {...(defaultChecked === undefined ? {} : { defaultChecked })}
        onCheckedChange={(next) => {
          if (checked === undefined) setUncontrolled(next)
          onCheckedChange?.(next)
        }}
        className={cn(
          // The target and the visual box are independent: compact icons must not become tiny
          // buttons. Preserve the 16/20px visual square within a 24px desktop /44px narrow target.
          'relative inline-flex size-6 max-md:size-11 shrink-0 items-center justify-center rounded-sm',
          'text-primary-foreground transition-colors duration-(--dur-micro) ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        <span
          data-slot="checkbox-box"
          className={cn(
            'relative inline-flex items-center justify-center rounded-sm border border-muted-foreground bg-card',
            'transition-colors duration-(--dur-micro) ease-out',
            value === true || value === 'indeterminate' ? 'border-primary bg-primary' : '',
            SIZE_CLASS[size],
          )}
        >
          <CheckboxPrimitive.Indicator
            forceMount
            className="flex items-center justify-center text-current"
          >
            {value === 'indeterminate' ? (
              <Minus className="size-3" aria-hidden="true" />
            ) : (
              <AnimatedCheck
                checked={isChecked}
                className={size === 'sm' ? 'size-3' : 'size-3.5'}
              />
            )}
          </CheckboxPrimitive.Indicator>
          {celebrate ? <Celebrate play={burst} onDone={() => setBurst(false)} /> : null}
        </span>
      </CheckboxPrimitive.Root>
    )
  },
)
Checkbox.displayName = 'Checkbox'

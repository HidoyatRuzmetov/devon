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
>(({ className, celebrate = false, size = 'md', checked, ...props }, ref) => {
  const isChecked = checked === true
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
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-sm border border-border bg-card',
        'text-primary-foreground transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        forceMount
        className="flex items-center justify-center text-current"
      >
        {checked === 'indeterminate' ? (
          <Minus className="size-3" aria-hidden="true" />
        ) : (
          <AnimatedCheck checked={isChecked} className={size === 'sm' ? 'size-3' : 'size-3.5'} />
        )}
      </CheckboxPrimitive.Indicator>
      {celebrate ? <Celebrate play={burst} onDone={() => setBurst(false)} /> : null}
    </CheckboxPrimitive.Root>
  )
})
Checkbox.displayName = 'Checkbox'

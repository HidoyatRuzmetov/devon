import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { motion } from 'motion/react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { springSettle } from '../motion/tokens.js'

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>

/** DESIGN.md §3 primitive. A switch means "this takes effect now" (a preference, a notification
 * channel); a checkbox means "this is part of what I am about to submit" -- the distinction every
 * settings screen in the product follows.
 *
 * The thumb travels on `spring.settle` and the track crossfades its fill over the same beat, so the
 * two halves of "this is on now" land together instead of the disc arriving before the colour does.
 * A spring rather than a tween because a switch is a physical metaphor — the thumb is a thing being
 * thrown to the other end of a track — and `spring.settle` is the catalogue's zero-bounce release,
 * so it arrives without ever overshooting into playfulness.
 *
 * Reduced motion drops the spring for an instant move; the track still crossfades (a colour change
 * is not travel). The position change *is* the feedback, so nothing is lost either way. */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, checked, defaultChecked, onCheckedChange, ...props }, ref) => {
  const reduced = useReducedMotion()
  // The thumb's position is a `motion` value now, not a CSS class Radix toggles, so this component
  // has to know the state itself -- including when the caller leaves the switch uncontrolled. This
  // is the standard controlled-or-not shim: `checked` wins when it is given, the local mirror is
  // what an uncontrolled switch reads, and the caller's `onCheckedChange` still fires either way.
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked ?? false)
  const isOn = checked ?? uncontrolled

  const handleChange = React.useCallback(
    (next: boolean) => {
      if (checked === undefined) setUncontrolled(next)
      onCheckedChange?.(next)
    },
    [checked, onCheckedChange],
  )

  return (
    <SwitchPrimitive.Root
      ref={ref}
      {...(checked === undefined ? {} : { checked })}
      {...(defaultChecked === undefined ? {} : { defaultChecked })}
      onCheckedChange={handleChange}
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // v1.1 critique SEV2 #16: `opacity-50` alone left a disabled switch only marginally dimmer
        // than an enabled one, so on `/department` a xodim could not tell at a glance that the toggles
        // were read-only. Opacity is now a real step, and -- because opacity alone is a weak signal in
        // dark, where everything is already low-contrast -- a read-only switch also loses its fill
        // (outline instead of solid) and its cursor. Three signals, none of them colour alone.
        'disabled:cursor-not-allowed disabled:opacity-40',
        'disabled:border-border disabled:shadow-none',
        'disabled:data-[state=checked]:bg-primary/35 disabled:data-[state=unchecked]:bg-muted-foreground/20',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          className={cn(
            'pointer-events-none block size-5 rounded-full bg-card shadow-1 ring-0',
            // The thumb of a read-only switch is a ring rather than a solid disc -- visible in both
            // themes without depending on the track's tint.
            'peer-disabled:bg-transparent',
          )}
          // 20px = the 44px track minus the 20px thumb and the 2px border on each side.
          animate={{ x: isOn ? 20 : 0 }}
          initial={false}
          transition={reduced ? { duration: 0 } : springSettle}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
})
Switch.displayName = 'Switch'

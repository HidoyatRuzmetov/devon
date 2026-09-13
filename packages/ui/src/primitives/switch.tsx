import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../lib/cn.js'

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>

/** DESIGN.md §3 primitive. A switch means "this takes effect now" (a preference, a notification
 * channel); a checkbox means "this is part of what I am about to submit" -- the distinction every
 * settings screen in the product follows.
 *
 * The thumb slides at `--dur-micro` via a CSS transform transition, which the reduced-motion
 * backstop collapses to an instant move: the position change *is* the feedback, so nothing is lost. */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
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
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block size-5 rounded-full bg-card shadow-1 ring-0',
        'transition-transform duration-(--dur-micro) ease-out',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        // The thumb of a read-only switch is a ring rather than a solid disc -- visible in both
        // themes without depending on the track's tint.
        'peer-disabled:bg-transparent',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { AnimatedCheck } from '../motion/animated-check.js'
import { crossfade, tweenMicro } from '../motion/tokens.js'

/** DESIGN.md §3: primary / secondary / ghost / destructive, sizes sm/md/lg, loading state.
 * `md` is 40px (44px at 390 per the touch-target floor -- callers set that at the call site with
 * `size="lg"` or a wrapping `min-h-11` on small screens; this component does not sniff viewport).
 *
 * UI-OVERHAUL.md §3 "Buttons": press scale 0.98, loading spinner morph, success check morph. The
 * press scale is a CSS `active:` transform rather than a `motion` `whileTap` deliberately -- a
 * button is the single most-pressed thing in the product and must not pay for a JS animation frame
 * on every click; the reduced-motion backstop in `tokens.css` collapses the transition to instant. */
export const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-normal rounded-md text-body font-medium ' +
    'transition-[colors,transform,box-shadow] duration-(--dur-micro) ease-out focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'border border-border bg-card text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
      },
      size: {
        sm: 'h-9 px-3 text-small',
        md: 'h-10 px-4',
        lg: 'h-11 px-6 text-lead',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renders the child element instead of a `<button>` (Radix `Slot`) -- e.g. a `Button` that is
   * really a router `<Link>`. */
  asChild?: boolean
  /** Shows a spinner in place of the label and disables the button; the label stays in the DOM
   * (visually hidden) so the button's width does not jump (spec.md §6.2: "never a layout jump"). */
  loading?: boolean
  /** Flips the label to a drawn check for a beat after a save succeeds (UI-OVERHAUL.md §3 "success
   * check morph"). The caller resets it -- a button does not decide how long "saved" is true. The
   * label stays in the DOM the whole time, so the width never jumps and a screen reader still reads
   * the action. */
  success?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      success = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    const reduced = useReducedMotion()

    // `asChild` hands the whole child tree to Radix's Slot, which needs exactly one element child --
    // the morph wrapper below would break that contract, so a slotted button renders plainly.
    if (asChild) {
      return (
        <Comp
          ref={ref}
          className={cn(buttonVariants({ variant, size }), className)}
          disabled={disabled ?? loading}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    const phase = loading ? 'loading' : success ? 'success' : 'idle'
    const transition = reduced ? crossfade : tweenMicro

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled ?? loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* The label always occupies the box; only its *visibility* morphs, so the button never
            resizes between idle → loading → success. */}
        <span
          className={cn(
            'inline-flex items-center gap-2 transition-opacity duration-(--dur-micro)',
            phase === 'idle' ? 'opacity-100' : 'opacity-0',
          )}
        >
          {children}
        </span>
        <AnimatePresence initial={false}>
          {phase !== 'idle' ? (
            <motion.span
              key={phase}
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
              transition={transition}
            >
              {phase === 'loading' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <AnimatedCheck checked className="size-5" />
              )}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </Comp>
    )
  },
)
Button.displayName = 'Button'

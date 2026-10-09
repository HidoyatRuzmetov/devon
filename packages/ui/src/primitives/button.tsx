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
 * `md` has a 40px minimum (44px on narrow screens per the touch-target floor -- callers set that with
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
        sm: 'min-h-9 px-3 py-2 text-small',
        md: 'min-h-10 px-4 py-2',
        lg: 'min-h-11 px-6 py-3 text-lead',
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
  /** Shown in place of the label while `loading` **under reduced motion only** -- e.g.
   * `t('state.loading')`. See the reduced-motion branch in the body: the spinner is replaced there
   * by a label crossfade plus an opacity pulse, and this is the text it crossfades to. Omit it and
   * the button's own label simply stays legible while it pulses. */
  loadingLabel?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingLabel,
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
          disabled={Boolean(disabled || loading)}
          aria-busy={loading || undefined}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    const phase = loading ? 'loading' : success ? 'success' : 'idle'
    const transition = reduced ? crossfade : tweenMicro
    // Motion verdict F10. `Loader2`'s `animate-spin` is a CSS animation, and `tokens.css`'s global
    // reduced-motion backstop clamps every animation to `0.01ms` / one iteration -- so under
    // reduced motion the spinner used to land on a single static frame and hold it for the whole
    // request, which reads as a broken button rather than a busy one. DESIGN.md §10's contract is
    // that motion is *replaced*, never deleted ("nothing becomes silent"), so the replacement is a
    // 2 s `opacity: 1 -> .72 -> 1` pulse (opacity is not a transform, so it honours the intent)
    // plus a crossfade of the label to `loadingLabel`. `.devon-busy-pulse` re-asserts its own
    // duration and iteration count past the backstop, the way `devon-shake` sidesteps it by never
    // relying on it at all.
    const busy = reduced && phase === 'loading'

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), busy && 'devon-busy-pulse', className)}
        disabled={Boolean(disabled || loading)}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* The label always occupies the box; only its *visibility* morphs, so the button never
            resizes between idle → loading → success. */}
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-2 transition-opacity duration-(--dur-micro) [&_svg]:shrink-0',
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
              // This decoration may leave between pointerdown and pointerup. Keep hit testing
              // on the stable button/label so a fast retry still produces a native click.
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
              transition={transition}
            >
              {phase === 'loading' ? (
                busy ? (
                  <span className="px-3 text-center">{loadingLabel ?? children}</span>
                ) : (
                  <Loader2 className="size-4 animate-spin" />
                )
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

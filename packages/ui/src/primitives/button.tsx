import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn.js'

/** DESIGN.md §3: primary / secondary / ghost / destructive, sizes sm/md/lg, loading state.
 * `md` is 40px (44px at 390 per the touch-target floor -- callers set that at the call site with
 * `size="lg"` or a wrapping `min-h-11` on small screens; this component does not sniff viewport). */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-normal rounded-md text-body font-medium ' +
    'transition-colors duration-(--dur-micro) ease-out focus-visible:outline-none ' +
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
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled ?? loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span className="sr-only">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

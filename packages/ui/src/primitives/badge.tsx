import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn.js'

/** DESIGN.md: "status is never conveyed by colour alone; every status chip carries a label and,
 * on boards, a leading glyph." This primitive renders the label always; a leading icon is the
 * caller's job (pass it as `children` alongside the text) since the required glyph differs by
 * meaning ("Ishlamoqda" vs "Ishlamayapti" use different icons, not just different colours). */
export const badgeVariants = cva(
  // `whitespace-nowrap shrink-0`: a fixed `h-6` box with unwrapped text only holds up if the text
  // never wraps -- verified this was missing by reproducing a real layout bug in the events list
  // (`EventCard`, apps/web/src/features/events/components/event-card.tsx): a two-word status label
  // ("Joylar to'lgan", tone `warning`) sharing a `justify-between` row with a long event title had no
  // room to keep its natural width, wrapped onto two lines inside the 24px-tall span, and visibly
  // spilled out of its own box into the illustration above it. `DemoChip` (packages/ui/src/shell/
  // demo-chip.tsx) already adds these two classes itself for exactly this reason ("visibly overlapping
  // the rest of the top bar" at 390px) -- every other Badge call site gets the same protection this
  // way, once, instead of every caller needing to remember it.
  'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-caption font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        attention: 'bg-attention text-attention-foreground',
        success: 'bg-success text-success-foreground',
        warning: 'bg-warning text-warning-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        info: 'bg-info text-info-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />
  ),
)
Badge.displayName = 'Badge'

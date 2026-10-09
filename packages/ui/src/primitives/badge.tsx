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
        // Brand tone, not a status -- "current device", "head of department": a fact about *this
        // item*, not a state it is in, so it never competes with the real status tones above.
        primary: 'bg-primary/12 text-primary',
      },
      // round2 SEV2: every tone was a solid saturated fill, so status was carried by "the brightest
      // block on the screen" everywhere at once -- 25 solid green "Faol" pills on one admin list, a
      // whole board of solid-fill priority badges. `subtle` (a tint of the tone over the current
      // surface, at 12% alpha so it composites correctly in both themes) is the default; `solid` is
      // kept for the one state that should still shout (a blocked/critical badge); `outline` is the
      // brand-tone chip ("Joriy qurilma", "Boshliq") that names a fact rather than a status.
      variant: {
        subtle: '',
        solid: '',
        outline: '',
      },
    },
    compoundVariants: [
      { tone: 'neutral', variant: 'subtle', className: 'bg-muted text-muted-foreground' },
      { tone: 'attention', variant: 'subtle', className: 'bg-attention/12 text-attention-text' },
      { tone: 'success', variant: 'subtle', className: 'bg-success/12 text-success-text' },
      { tone: 'warning', variant: 'subtle', className: 'bg-warning/12 text-warning-text' },
      { tone: 'destructive', variant: 'subtle', className: 'bg-destructive/12 text-destructive' },
      { tone: 'info', variant: 'subtle', className: 'bg-info/12 text-info-text' },
      { tone: 'primary', variant: 'subtle', className: 'bg-primary/12 text-primary' },
      { tone: 'neutral', variant: 'solid', className: 'bg-muted text-muted-foreground' },
      { tone: 'attention', variant: 'solid', className: 'bg-attention text-attention-foreground' },
      { tone: 'success', variant: 'solid', className: 'bg-success text-success-foreground' },
      { tone: 'warning', variant: 'solid', className: 'bg-warning text-warning-foreground' },
      {
        tone: 'destructive',
        variant: 'solid',
        className: 'bg-destructive text-destructive-foreground',
      },
      { tone: 'info', variant: 'solid', className: 'bg-info text-info-foreground' },
      { tone: 'primary', variant: 'solid', className: 'bg-primary text-primary-foreground' },
      {
        tone: 'primary',
        variant: 'outline',
        className: 'border border-primary bg-transparent text-primary',
      },
    ],
    defaultVariants: { tone: 'neutral', variant: 'subtle' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone, variant }), className)} {...props} />
  ),
)
Badge.displayName = 'Badge'

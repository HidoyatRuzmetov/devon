import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn.js'

/** DESIGN.md: "status is never conveyed by colour alone; every status chip carries a label and,
 * on boards, a leading glyph." This primitive renders the label always; a leading icon is the
 * caller's job (pass it as `children` alongside the text) since the required glyph differs by
 * meaning ("Ishlamoqda" vs "Ishlamayapti" use different icons, not just different colours). */
export const badgeVariants = cva(
  'inline-flex h-6 items-center gap-1 rounded-sm px-2 text-caption font-medium',
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

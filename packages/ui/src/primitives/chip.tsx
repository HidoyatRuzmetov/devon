import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Plus, X } from 'lucide-react'
import { cn } from '../lib/cn.js'

/** DESIGN.md §3 "Chip/Tag". Distinct from `Badge`: a badge *states* something (a status, a count)
 * and is never interactive; a chip is a thing the user put there and can usually take away (a label
 * on a card, a filter in a filter bar, a person on a watchers list). */
export const chipVariants = cva(
  'inline-flex h-6 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 ' +
    'text-caption font-medium transition-colors duration-(--dur-micro) ease-out',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground',
        primary: 'bg-accent text-accent-foreground',
        attention: 'bg-attention/20 text-foreground',
        success: 'bg-success/15 text-foreground',
        destructive: 'bg-destructive/15 text-foreground',
        info: 'bg-info/15 text-foreground',
        outline: 'border border-border bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof chipVariants> {
  /** A leading dot in a unit/label colour -- the "colour is never the only signal" rule means the
   * text is always there too, so the dot is decoration that helps scanning, not the message. */
  dotClassName?: string
  /** A leading icon (or any other node) rendered before the label, outside the truncating span so
   * it never overlaps the text. Sits beside `dotClassName`'s dot if both are given. */
  leading?: React.ReactNode
  /** Renders a remove button. `onRemove` is what makes a chip a chip rather than a badge. */
  onRemove?: () => void
  removeLabel?: string
}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, tone, dotClassName, leading, onRemove, removeLabel, children, ...props }, ref) => (
    <span ref={ref} className={cn(chipVariants({ tone }), className)} {...props}>
      {dotClassName ? (
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dotClassName)} />
      ) : null}
      {leading ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? ''}
          className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--dur-micro) hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  ),
)
Chip.displayName = 'Chip'

export interface FilterChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /** Right-hand count, the way Linear labels a filter value. */
  count?: number
  /** Renders the "+ Filter" affordance instead of a value chip. */
  addVariant?: boolean
}

/** UI-OVERHAUL.md §2 "Filters": chips with type-ahead, a "+ Filter" popover, saved views as tabs,
 * URL is the state. This is the chip half -- a *button*, because a filter chip is always pressable
 * (toggle it off, or open its value popover). */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ className, active = false, count, addVariant = false, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={addVariant ? undefined : active}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3',
        'text-small transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        addVariant
          ? 'border-dashed border-border text-muted-foreground hover:border-primary hover:text-foreground'
          : active
            ? 'border-primary bg-accent text-accent-foreground'
            : 'border-border bg-card text-foreground hover:bg-accent',
        className,
      )}
      {...props}
    >
      {addVariant ? <Plus className="size-3.5" aria-hidden="true" /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {typeof count === 'number' ? (
        <span className="tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </button>
  ),
)
FilterChip.displayName = 'FilterChip'

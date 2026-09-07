import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn.js'
import { HoverLift } from '../motion/hover-lift.js'

export const cardVariants = cva(
  'rounded-md border border-border bg-card text-foreground transition-colors duration-(--dur-micro) ease-out',
  {
    variants: {
      elevation: {
        flat: '',
        raised: 'shadow-1',
        overlay: 'shadow-2',
      },
      padding: {
        none: '',
        sm: 'p-4',
        md: 'p-5',
        lg: 'p-6',
      },
      /** A dashed card is the "nothing here yet, add one" affordance (a column foot, an empty
       * pinned-charts slot) -- never a normal content card. */
      dashed: { true: 'border-dashed bg-transparent', false: '' },
    },
    defaultVariants: { elevation: 'raised', padding: 'md', dashed: false },
  },
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  /** UI-OVERHAUL.md §3 "Cards": hover lift −2 px + shadow step. On for anything clickable, off for
   * a static panel -- lifting something that does nothing when clicked is a lie. */
  interactive?: boolean
}

/** DESIGN.md §3 surface primitive. Every panel in the product is this card or a `SectionCard`
 * (settings) -- a screen never hand-rolls `rounded-md border bg-card` again. */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation, padding, dashed, interactive = false, children, ...props }, ref) => {
    const card = (
      <div
        ref={ref}
        className={cn(
          cardVariants({ elevation, padding, dashed }),
          interactive && 'cursor-pointer hover:border-primary/40',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
    // `h-full` so a lifting card in a grid row still stretches to the tallest sibling -- without
    // it the wrapper collapses to its content and the row looks ragged.
    return interactive ? <HoverLift className="h-full rounded-md">{card}</HoverLift> : card
  },
)
Card.displayName = 'Card'

export interface SectionCardProps extends React.HTMLAttributes<HTMLElement> {
  title: string
  description?: string
  /** The save button / danger action for this section, right-aligned in the footer. */
  actions?: React.ReactNode
  /** Small right-aligned element in the header (a switch, a badge). */
  headerAside?: React.ReactNode
}

/** UI-OVERHAUL.md §2 "Settings": left sub-nav, sections as cards, save per section with a toast,
 * danger zone at the bottom. This is one of those sections -- a titled card with its own action row,
 * so a settings screen is a list of these and nothing else. */
export const SectionCard = React.forwardRef<HTMLElement, SectionCardProps>(
  ({ className, title, description, actions, headerAside, children, ...props }, ref) => (
    <section
      ref={ref}
      className={cn('rounded-md border border-border bg-card shadow-1', className)}
      {...props}
    >
      <header className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="text-h3 text-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 text-small text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
      {actions ? (
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
          {actions}
        </footer>
      ) : null}
    </section>
  ),
)
SectionCard.displayName = 'SectionCard'

import * as React from 'react'
import * as HoverCardPrimitive from '@radix-ui/react-hover-card'
import { cn } from '../lib/cn.js'
import { HOVER_CARD_DELAY_MS } from './tokens.js'

export const HoverCardTrigger = HoverCardPrimitive.Trigger

export interface HoverCardProps {
  children: React.ReactNode
  /** Milliseconds before the card opens. Defaults to the catalogue's 150 ms so a pointer crossing a
   * dense list never flashes a card per row (UI-OVERHAUL.md §3). */
  openDelay?: number
  closeDelay?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function HoverCard({
  children,
  openDelay = HOVER_CARD_DELAY_MS,
  closeDelay = 100,
  ...props
}: HoverCardProps): React.JSX.Element {
  return (
    <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props}>
      {children}
    </HoverCardPrimitive.Root>
  )
}

export type HoverCardContentProps = React.ComponentPropsWithoutRef<
  typeof HoverCardPrimitive.Content
>

/** UI-OVERHAUL.md §3 "Hover cards (people, cards)": fade + 4 px rise, 150 ms open delay. The rise
 * is a Radix `data-state` keyframe (`devon-hover-card-in`) so the reduced-motion backstop in
 * `tokens.css` collapses it to an instant appearance without this component branching. */
export const HoverCardContent = React.forwardRef<
  React.ComponentRef<typeof HoverCardPrimitive.Content>,
  HoverCardContentProps
>(({ className, sideOffset = 8, ...props }, ref) => (
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-md border border-border bg-card p-4 text-body text-foreground shadow-2',
        'data-[state=open]:animate-[devon-hover-card-in_140ms_var(--ease-out)]',
        'data-[state=closed]:animate-[devon-fade-out_140ms_var(--ease-in)]',
        className,
      )}
      {...props}
    />
  </HoverCardPrimitive.Portal>
))
HoverCardContent.displayName = 'HoverCardContent'

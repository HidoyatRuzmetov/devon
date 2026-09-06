import * as React from 'react'
import { Drawer } from 'vaul'
import { cn } from '../lib/cn.js'

/** Vaul on mobile (DESIGN.md §3), used for the Sidebar drawer at 390 and the SearchOverlay bottom
 * sheet. `direction` follows spec.md: `left` for the nav drawer (§3.4), `bottom` for the search
 * overlay (§5). Vaul drives its own drag physics; it already respects `prefers-reduced-motion` for
 * the snap animation via the browser's own reduced-motion handling in its internal transitions. */
export const Sheet = Drawer.Root
export const SheetTrigger = Drawer.Trigger
export const SheetClose = Drawer.Close
export const SheetPortal = Drawer.Portal

export const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof Drawer.Overlay>,
  React.ComponentPropsWithoutRef<typeof Drawer.Overlay>
>(({ className, ...props }, ref) => (
  <Drawer.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-foreground/40', className)}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof Drawer.Content> {
  title: string
  side?: 'left' | 'bottom'
}

const SIDE_CLASS: Record<'left' | 'bottom', string> = {
  left: 'inset-y-0 left-0 h-full w-75 max-w-[85vw] rounded-r-lg',
  bottom: 'inset-x-0 bottom-0 max-h-[60vh] rounded-t-lg',
}

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof Drawer.Content>,
  SheetContentProps
>(({ className, title, side = 'left', children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <Drawer.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col border border-border bg-card shadow-3 outline-none',
        SIDE_CLASS[side],
        className,
      )}
      {...props}
    >
      <Drawer.Title className="sr-only">{title}</Drawer.Title>
      {children}
    </Drawer.Content>
  </SheetPortal>
))
SheetContent.displayName = 'SheetContent'

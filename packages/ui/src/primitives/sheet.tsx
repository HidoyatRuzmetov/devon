import * as React from 'react'
import { Drawer } from 'vaul'
import { cn } from '../lib/cn.js'

/** Vaul on mobile (DESIGN.md §3), used for the Sidebar drawer at 390, the search bottom sheet and
 * every routed detail panel that becomes a sheet below 768. `direction` follows spec.md: `left` for
 * the nav drawer (§3.4), `bottom` for the search overlay (§5), `right` for a detail panel.
 *
 * UI-OVERHAUL.md §3 "Dialog / Sheet": the sheet enters on `spring.sheet`. Vaul drives that spring
 * itself (its snap/settle physics are its whole reason for existing here) and already honours
 * `prefers-reduced-motion` through the browser's own transition handling -- so this file styles the
 * surface and leaves the physics alone rather than fighting it with a second animation. */
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
    className={cn('fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[3px]', className)}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof Drawer.Content> {
  title: string
  side?: 'left' | 'right' | 'bottom'
  /** A bottom sheet gets the grab handle every mobile user already expects (Jakob's Law); a side
   * drawer does not, because it is dismissed by tapping the scrim or swiping the edge. */
  showHandle?: boolean
}

const SIDE_CLASS: Record<'left' | 'right' | 'bottom', string> = {
  left: 'inset-y-0 left-0 h-full w-75 max-w-[85vw] rounded-r-lg border-r',
  right: 'inset-y-0 right-0 h-full w-(--width-detail-panel) max-w-[92vw] rounded-l-lg border-l',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t',
}

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof Drawer.Content>,
  SheetContentProps
>(({ className, title, side = 'left', showHandle, children, ...props }, ref) => {
  const handle = showHandle ?? side === 'bottom'
  return (
    <SheetPortal>
      <SheetOverlay />
      <Drawer.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border-border bg-surface-3 shadow-3 outline-none',
          SIDE_CLASS[side],
          className,
        )}
        {...props}
      >
        <Drawer.Title className="sr-only">{title}</Drawer.Title>
        {handle ? (
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border"
          />
        ) : null}
        {children}
      </Drawer.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = 'SheetContent'

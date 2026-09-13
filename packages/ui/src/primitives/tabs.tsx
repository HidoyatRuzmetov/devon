import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion, LayoutGroup } from 'motion/react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { springSettle, tweenOut, crossfade } from '../motion/tokens.js'

export const Tabs = TabsPrimitive.Root

/** UI-OVERHAUL.md §3 "Sidebar active item, tabs": the underline morphing between triggers was the
 * only motion a tab change carried -- the panel itself (Radix unmounts the inactive one by default,
 * so this only ever mounts when it becomes the active tab) just appeared. A plain fade + rise, the
 * same shape `Reveal` uses elsewhere, gives every `Tabs` consumer in the app (the project page,
 * the admin console, ...) a crossfade for free. */
export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ children, className, ...props }, ref) => {
  const reduced = useReducedMotion()
  return (
    <TabsPrimitive.Content ref={ref} {...props} asChild>
      <motion.div
        className={className}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? crossfade : tweenOut}
      >
        {children}
      </motion.div>
    </TabsPrimitive.Content>
  )
})
TabsContent.displayName = 'TabsContent'

const TabsIdContext = React.createContext('devon-tabs')

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const layoutId = React.useId()
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = React.useState({ start: false, end: false })

  /**
   * v1.1 critique SEV2 #25. The event sheet's strip is 724 px of tabs in 420 px of space, and it
   * rendered no scroll affordance at all -- so the last tab was cut mid-word ("Fikr-mul") and read
   * as a rendering bug rather than as more content. Hiding the native scrollbar (below) fixed one
   * problem and created this one.
   *
   * The fade is measured rather than assumed: a strip that fits shows nothing, and the two edges are
   * independent, so after scrolling right the left edge fades too. Recomputed on scroll, on resize
   * and whenever the tab set changes.
   */
  const measure = React.useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const start = el.scrollLeft > 2
    const end = max - el.scrollLeft > 2
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  React.useEffect(() => {
    measure()
    const el = scrollerRef.current
    if (!el) return undefined
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    observer?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, children])

  return (
    <TabsIdContext.Provider value={layoutId}>
      <LayoutGroup id={layoutId}>
        <div className="relative">
          <TabsPrimitive.List
            ref={(node) => {
              scrollerRef.current = node
              if (typeof ref === 'function') ref(node)
              else if (ref) ref.current = node
            }}
            onScroll={measure}
            // SEV2 #25's other half: keyboard reachability. Radix moves the roving tabindex with the
            // arrow keys, but a tab that has scrolled out of view stays out of view when it takes
            // focus, so a keyboard user tabs into something they cannot see. `'nearest'` scrolls the
            // minimum needed and never yanks the strip when the tab is already visible.
            onFocusCapture={(event) => {
              const target = event.target as HTMLElement | null
              target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
              measure()
            }}
            className={cn(
              'relative flex items-center gap-1 overflow-x-auto border-b border-border',
              // v1.1 (WALKTHROUGH-FINDINGS 2.6): at 390px a full-width native horizontal scrollbar
              // rendered *inside* the event sheet, under the tab strip, reading as a broken layout.
              // The strip still scrolls -- swipe, arrow keys and Tab all work -- it just no longer
              // paints a system scrollbar across the sheet. Firefox and WebKit/Blink each need their
              // own property for this; neither has a Tailwind utility.
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              className,
            )}
            {...props}
          >
            {children}
          </TabsPrimitive.List>
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent',
              'transition-opacity duration-(--dur-standard) ease-(--ease-standard)',
              edges.start ? 'opacity-100' : 'opacity-0',
            )}
          />
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent',
              'transition-opacity duration-(--dur-standard) ease-(--ease-standard)',
              edges.end ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>
      </LayoutGroup>
    </TabsIdContext.Provider>
  )
})
TabsList.displayName = 'TabsList'

export interface TabsTriggerProps extends React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
> {
  /** Right-aligned count, the way Linear and Jira label a view. */
  count?: number
}

/** UI-OVERHAUL.md §3 "Sidebar active item, tabs": the underline *morphs* from the old tab to the new
 * one via a shared `layoutId` on `spring.settle` -- so the eye follows one object moving instead of
 * two separate things blinking. Under reduced motion the underline is rendered without the shared
 * layout, i.e. it simply appears under the selected tab: the selection is still unmistakable, it
 * just does not travel. */
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, children, count, ...props }, ref) => {
  const layoutId = React.useContext(TabsIdContext)
  const reduced = useReducedMotion()
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'group relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-body',
        'text-muted-foreground transition-colors duration-(--dur-micro) ease-out',
        'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:font-medium data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {typeof count === 'number' ? (
        <span className="rounded-full bg-muted px-1.5 text-caption tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      <span className="absolute inset-x-0 -bottom-px hidden h-0.5 group-data-[state=active]:block">
        {reduced ? (
          <span className="block size-full rounded-full bg-primary" />
        ) : (
          <motion.span
            layoutId={`${layoutId}-underline`}
            className="block size-full rounded-full bg-primary"
            transition={springSettle}
          />
        )}
      </span>
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = 'TabsTrigger'

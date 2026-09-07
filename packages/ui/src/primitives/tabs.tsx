import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion, LayoutGroup } from 'motion/react'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { springSettle } from '../motion/tokens.js'

export const Tabs = TabsPrimitive.Root
export const TabsContent = TabsPrimitive.Content

const TabsIdContext = React.createContext('devon-tabs')

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const layoutId = React.useId()
  return (
    <TabsIdContext.Provider value={layoutId}>
      <LayoutGroup id={layoutId}>
        <TabsPrimitive.List
          ref={ref}
          className={cn(
            'relative flex items-center gap-1 overflow-x-auto border-b border-border',
            className,
          )}
          {...props}
        >
          {children}
        </TabsPrimitive.List>
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

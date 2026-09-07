import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface DataListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** DESIGN.md §2.4: `comfortable` rows are 44 px, `compact` 36 px. The toggle belongs to the
   * screen (tables and boards offer it); everything else picks one and stays there. */
  density?: 'comfortable' | 'compact'
  /** Renders a sticky header row above the list -- Linear/Notion's convention for a dense list. */
  header?: React.ReactNode
  /** Accessible name, e.g. `t('work.table.aria')`. */
  label?: string
}

const DensityContext = React.createContext<'comfortable' | 'compact'>('comfortable')

/** UI-OVERHAUL.md §2 "Table view": dense rows, sticky header. `DataList` + `DataRow` are the two
 * primitives every dense list in the product is built from -- the inbox list, the archive, the audit
 * log, the people directory -- so row height, hover, selection and keyboard focus behave identically
 * in all of them. It is deliberately *not* a table component: a real `DataTable` (TanStack) is a
 * later, heavier thing; this is the rhythm those and every simpler list share. */
export function DataList({
  density = 'comfortable',
  header,
  label,
  className,
  children,
  ...props
}: DataListProps): React.JSX.Element {
  return (
    <DensityContext.Provider value={density}>
      <div
        role="list"
        {...(label ? { 'aria-label': label } : {})}
        className={cn(
          'flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card',
          className,
        )}
        {...props}
      >
        {header ? (
          <div className="sticky top-(--height-topbar) z-10 flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {header}
          </div>
        ) : null}
        {children}
      </div>
    </DensityContext.Provider>
  )
}

export interface DataRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Renders the row as a button-like target with hover and press feedback. */
  interactive?: boolean
  selected?: boolean
  /** A 3 px leading rail in a token colour -- the "unread"/"overdue" signal a dense list needs to be
   * scannable. Always paired with a text label by the caller; colour is never the only signal. */
  railClassName?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
}

/** One row. `leading`/`trailing` are slots so a caller never has to fight the row's flex layout to
 * put a checkbox on the left and a due chip on the right. */
export const DataRow = React.forwardRef<HTMLDivElement, DataRowProps>(
  (
    {
      className,
      interactive = false,
      selected = false,
      railClassName,
      leading,
      trailing,
      children,
      ...props
    },
    ref,
  ) => {
    const density = React.useContext(DensityContext)
    return (
      <div
        ref={ref}
        role="listitem"
        {...(interactive ? { tabIndex: 0 } : {})}
        {...(selected ? { 'aria-current': true as const } : {})}
        className={cn(
          'relative flex min-w-0 items-center gap-3 border-b border-border px-4 last:border-b-0',
          'transition-colors duration-(--dur-micro) ease-out',
          density === 'compact' ? 'min-h-9 py-1.5' : 'min-h-11 py-2',
          interactive &&
            'cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent/70',
          selected && 'bg-accent',
          className,
        )}
        {...props}
      >
        {railClassName ? (
          <span
            aria-hidden="true"
            className={cn('absolute inset-y-1 left-0 w-0.75 rounded-full', railClassName)}
          />
        ) : null}
        {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
        <span className="flex min-w-0 flex-1 items-center gap-3">{children}</span>
        {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
      </div>
    )
  },
)
DataRow.displayName = 'DataRow'

import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface PageHeaderProps {
  title: string
  /** One line under the title saying what this screen is for. Optional, but a screen with no
   * description had better be self-evident. */
  description?: string
  /** Small-caps eyebrow above the title (the area this page belongs to). */
  eyebrow?: string
  /** Breadcrumb or back link, rendered above the eyebrow. */
  above?: React.ReactNode
  /** Primary action and related contextual controls; wraps below the title when space is limited. */
  actions?: React.ReactNode
  /** A `<TabsList>`; sits on the header's bottom edge so the tab underline and the header hairline
   * are the same line (Linear's shape). */
  tabs?: React.ReactNode
  className?: string
}

/** UI-OVERHAUL.md §2 row 1: "page header = title + description + primary action + tabs". Every
 * screen in the product opens with exactly this component -- that is what makes twenty screens built
 * by six agents read as one product. */
export function PageHeader({
  title,
  description,
  eyebrow,
  above,
  actions,
  tabs,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className={cn('flex flex-col gap-4', className)}>
      {above ? <div className="min-w-0">{above}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          {eyebrow ? (
            <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="break-words font-display text-h1 text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-160 text-body text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {tabs ? <div className="-mb-px min-w-0">{tabs}</div> : null}
    </header>
  )
}

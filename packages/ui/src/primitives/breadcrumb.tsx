import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/cn.js'

export interface BreadcrumbItem {
  label: string
  /** Omit on the last item -- the page you are on is not a link (Jakob's Law, every product does
   * this and a link to the current page is a WCAG annoyance, not a feature). */
  href?: string
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[]
  /** Accessible name for the nav landmark, e.g. `t('shell.breadcrumb.aria')`. */
  label: string
  /** Defaults to a plain `<a>`; pass the router's Link so a click does not reload the page. */
  linkAs?: React.ElementType
  className?: string
}

/** DESIGN.md §3 primitive. Renders an ordered list inside a `nav`, with the current page marked
 * `aria-current="page"` -- the shape assistive technology expects, not a row of divs. */
export function Breadcrumb({
  items,
  label,
  linkAs: Link = 'a',
  className,
}: BreadcrumbProps): React.JSX.Element {
  return (
    <nav aria-label={label} className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-small text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="rounded-sm transition-colors duration-(--dur-micro) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  {...(isLast ? { 'aria-current': 'page' as const } : {})}
                  className={cn('min-w-0', isLast && 'text-foreground')}
                >
                  {item.label}
                </span>
              )}
              {isLast ? null : (
                <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

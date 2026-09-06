import * as React from 'react'
import { useT } from '@devon/i18n'
import { cn } from '../lib/cn.js'
import { resolveNavEntries, type NavContext, type NavEntry } from './nav-registry.js'

export interface SidebarProps {
  entries: readonly NavEntry[]
  ctx: NavContext
  /** The current route, compared against each entry's `route` for `aria-current`. */
  activeRoute: string
  /** Defaults to a plain `<a>`. Pass a router's Link (e.g. `Link` from `react-router`) so
   * navigation does not force a full page reload -- this package has no router dependency of its
   * own (DOES NOT touch apps/web; routing is `apps/web`'s call). */
  linkAs?: React.ElementType
  wordmark: React.ReactNode
  /** spec.md §3.1 area 7: the credit line, e.g. `t('shell.credit')`, rendered in `--color-official`. */
  creditText: string
  footer?: React.ReactNode
  collapsed?: boolean
  className?: string
}

/** design.md §3 Sidebar / spec.md §3.2-§3.6. Fixed 264px (rail 64px when the user collapses it --
 * spec.md §3.3: this is a *user toggle*, never an automatic collapse at 1024, and it never becomes
 * icon-only without the caller passing `collapsed`). No `truncate` anywhere in this file -- enforced
 * by the package-local ESLint rule scoped to `src/shell/**`. */
export function Sidebar({
  entries,
  ctx,
  activeRoute,
  linkAs: Link = 'a',
  wordmark,
  creditText,
  footer,
  collapsed = false,
  className,
}: SidebarProps) {
  const t = useT()
  const visible = resolveNavEntries(entries, ctx)

  return (
    <nav
      className={cn(
        'flex h-full flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-(--dur-page) ease-(--ease-emphasized)',
        collapsed ? 'w-(--width-sidebar-rail)' : 'w-(--width-sidebar)',
        className,
      )}
    >
      <div className="flex h-14 items-center px-4">
        <span
          data-shell-label
          className={cn('min-w-0 font-display text-h3', collapsed && 'sr-only')}
        >
          {wordmark}
        </span>
      </div>

      <ul className="flex flex-col gap-1 px-3">
        {visible.map((entry) => {
          const isActive = entry.route === activeRoute
          const Icon = entry.icon
          return (
            <li key={entry.id} className="min-w-0">
              <Link
                href={entry.route}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-11 min-w-0 items-center gap-3 rounded-sm px-3 text-body',
                  'transition-colors duration-(--dur-micro) ease-out hover:bg-sidebar-accent',
                  isActive && 'bg-sidebar-accent',
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1 left-0 w-0.75 rounded-full bg-attention"
                  />
                ) : null}
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                {/* wraps rather than truncates -- design.md §3.5 anti-truncation contract */}
                <span data-shell-label className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>
                  {t(entry.labelKey)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="mt-auto flex flex-col gap-3 px-4 py-4">
        {footer}
        <p data-shell-label className={cn('text-caption text-official', collapsed && 'sr-only')}>
          {creditText}
        </p>
      </div>
    </nav>
  )
}

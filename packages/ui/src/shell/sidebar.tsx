import * as React from 'react'
import { motion } from 'motion/react'
import { useT } from '@devon/i18n'
import { cn } from '../lib/cn.js'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { springSettle } from '../motion/tokens.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../primitives/tooltip.js'
import { resolveNavEntries, type NavContext, type NavEntry } from './nav-registry.js'

/** A titled block of sidebar entries -- Linear, Huly and Notion all group a long nav rather than
 * showing fifteen flat rows. `labelKey` is omitted for the first, unlabelled block (Home, Inbox):
 * the top of a sidebar never needs a heading to be understood. */
export interface NavGroup {
  id: string
  labelKey?: string
  /** Entry ids, in the order they should appear. An id that is not visible for this session (or does
   * not exist) is silently skipped, so a group never renders a hole. */
  entryIds: readonly string[]
}

export interface SidebarProps {
  entries: readonly NavEntry[]
  ctx: NavContext
  /** The current route, compared against each entry's `route` for `aria-current`. */
  activeRoute: string
  /** Defaults to a plain `<a>`. Pass a router's Link (e.g. `RouterLink`) so navigation does not
   * force a full page reload -- this package has no router dependency of its own. */
  linkAs?: React.ElementType
  wordmark: React.ReactNode
  /** spec.md §3.1 area 7: the credit line, e.g. `t('shell.credit')`, rendered in `--color-official`. */
  creditText: string
  /** Optional grouping (UI-OVERHAUL.md §2 row 1: "left sidebar with grouped items and counts").
   * Without it the sidebar renders one flat list, exactly as it did before the overhaul. */
  groups?: readonly NavGroup[]
  /** Live counts by entry id, right-aligned in the row. A count is a *fact about the user's work*
   * (six unread, four overdue), never a "soon" badge -- `nav-registry.ts` still refuses those. */
  counts?: Readonly<Record<string, number | null | undefined>>
  /** The department switcher, above the nav. */
  header?: React.ReactNode
  /** The user block, below the nav and above the credit line. */
  footer?: React.ReactNode
  collapsed?: boolean
  className?: string
}

/** design.md §3 Sidebar / spec.md §3.2-§3.6, rebuilt to UI-OVERHAUL.md §2 row 1 (Linear / Huly /
 * Notion / Vercel): grouped entries with counts, a morphing active pill, collapse to an icon rail
 * with tooltips, a department switcher on top and a user block at the foot.
 *
 * Fixed 264px (rail 64px when the user collapses it -- spec.md §3.3: this is a *user toggle*, never
 * an automatic collapse at 1024). No `truncate` anywhere in this file -- enforced by the
 * package-local ESLint rule scoped to `src/shell/**`, because Uzbek and Russian labels run 20-35%
 * longer than English and the fix for an overflowing label is a shorter key, never a clipped one. */
export function Sidebar({
  entries,
  ctx,
  activeRoute,
  linkAs: Link = 'a',
  wordmark,
  creditText,
  groups,
  counts,
  header,
  footer,
  collapsed = false,
  className,
}: SidebarProps) {
  const visible = resolveNavEntries(entries, ctx)
  const byId = new Map(visible.map((entry) => [entry.id, entry]))

  const rendered: Array<{ id: string; labelKey?: string; entries: NavEntry[] }> = []
  if (groups && groups.length > 0) {
    const claimed = new Set<string>()
    for (const group of groups) {
      const groupEntries = group.entryIds
        .map((id) => byId.get(id))
        .filter((entry): entry is NavEntry => Boolean(entry))
      for (const entry of groupEntries) claimed.add(entry.id)
      if (groupEntries.length > 0) {
        rendered.push({
          id: group.id,
          ...(group.labelKey ? { labelKey: group.labelKey } : {}),
          entries: groupEntries,
        })
      }
    }
    // Anything a feature registered that no group claims still has to appear -- a new manifest must
    // never be invisible just because this file has not heard of it yet.
    const leftovers = visible.filter((entry) => !claimed.has(entry.id))
    if (leftovers.length > 0) rendered.push({ id: 'other', entries: leftovers })
  } else {
    rendered.push({ id: 'all', entries: visible })
  }

  return (
    <nav
      className={cn(
        'flex h-full flex-col bg-sidebar text-sidebar-foreground',
        'transition-[width] duration-(--dur-page) ease-(--ease-emphasized)',
        collapsed ? 'w-(--width-sidebar-rail)' : 'w-(--width-sidebar)',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-(--height-topbar) items-center',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <span
          data-shell-label
          className={cn('min-w-0 font-display text-h3', collapsed && 'sr-only')}
        >
          {wordmark}
        </span>
      </div>

      {header ? <div className={cn(collapsed ? 'px-2' : 'px-3', 'pb-2')}>{header}</div> : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2">
        {rendered.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.labelKey && !collapsed ? (
              <p
                data-shell-label
                className="px-6 pb-1 text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-sidebar-muted"
              >
                <GroupLabel labelKey={group.labelKey} />
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5 px-3">
              {group.entries.map((entry) => (
                <SidebarItem
                  key={entry.id}
                  entry={entry}
                  active={entry.route === activeRoute}
                  collapsed={collapsed}
                  count={counts?.[entry.id] ?? null}
                  Link={Link}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div
        className={cn(
          'mt-auto flex shrink-0 flex-col gap-3 border-t border-sidebar-border py-3',
          collapsed ? 'px-2' : 'px-3',
        )}
      >
        {footer}
        <p
          data-shell-label
          className={cn('px-1 text-caption text-sidebar-muted', collapsed && 'sr-only')}
        >
          {creditText}
        </p>
      </div>
    </nav>
  )
}

function GroupLabel({ labelKey }: { labelKey: string }) {
  const t = useT()
  return <>{t(labelKey)}</>
}

function SidebarItem({
  entry,
  active,
  collapsed,
  count,
  Link,
}: {
  entry: NavEntry
  active: boolean
  collapsed: boolean
  count: number | null
  Link: React.ElementType
}) {
  const t = useT()
  const reduced = useReducedMotion()
  const Icon = entry.icon
  const label = t(entry.labelKey)

  const row = (
    <Link
      href={entry.route}
      aria-current={active ? 'page' : undefined}
      // H5.2 "prefetch on hover/focus": a mouse hover and a keyboard tab-to-focus are the two ways a
      // person reaches this link before actually activating it -- both warm the route's data.
      onMouseEnter={entry.onPrefetch}
      onFocus={entry.onPrefetch}
      className={cn(
        'relative flex min-h-9 min-w-0 items-center gap-3 rounded-sm px-3 text-body',
        'transition-colors duration-(--dur-micro) ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active
          ? 'text-sidebar-foreground'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60',
        collapsed && 'justify-center px-0',
      )}
    >
      {/* UI-OVERHAUL.md §3 "Sidebar active item": the fill is one object that *moves* between rows
          via a shared layout id, so the eye tracks a single pill rather than two blinks. Under
          reduced motion the same pill is drawn without the shared layout -- it simply appears. */}
      {active ? (
        reduced ? (
          <span aria-hidden="true" className="absolute inset-0 rounded-sm bg-sidebar-accent" />
        ) : (
          <motion.span
            layoutId="devon-sidebar-active"
            aria-hidden="true"
            className="absolute inset-0 rounded-sm bg-sidebar-accent"
            transition={springSettle}
          />
        )
      ) : null}
      <Icon className="relative size-4.5 shrink-0" aria-hidden="true" />
      {/* wraps rather than truncates -- design.md §3.5 anti-truncation contract */}
      <span
        data-shell-label
        className={cn('relative min-w-0 flex-1 text-left', collapsed && 'sr-only')}
      >
        {label}
      </span>
      {count && count > 0 ? (
        collapsed ? (
          // On the rail there is no room for a number; a dot says "there is something here" and the
          // tooltip carries the name. The count itself is one hover (or one expand) away.
          <span
            aria-hidden="true"
            className="absolute right-2 top-1.5 size-2 rounded-full bg-attention"
          />
        ) : (
          <span className="relative shrink-0 rounded-full bg-sidebar-accent px-1.5 text-caption tabular-nums text-sidebar-foreground">
            {count > 99 ? '99+' : count}
          </span>
        )
      ) : null}
    </Link>
  )

  return (
    <li className="min-w-0">
      {collapsed ? (
        // Its own provider rather than relying on the app's: the collapsed rail is the one place a
        // label is *only* available as a tooltip, so it must work wherever the sidebar is mounted
        // (including a Storybook story or a test that renders it alone). Nesting providers is
        // supported by Radix and costs nothing.
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>{row}</TooltipTrigger>
            <TooltipContent side="right">
              <span data-shell-label>{label}</span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        row
      )}
    </li>
  )
}

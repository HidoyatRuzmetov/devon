// Shared chrome for every work-module route: the view-switcher tabs (Board/Table/Timeline/Calendar/
// Mine/Archive), the quick-add bar and the filter bar. One component so a filter typed on the board
// is still there after clicking over to Table (TECH-SPEC "table, timeline, calendar and mine show the
// same cards") -- the current `?q=` search string rides along on every tab link.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { RouterLink, useRoutePath, useSearchParams } from '../../../lib/router.js'
import { cn } from '@devon/ui'
import { useBoardQuery } from '../hooks.js'
import { FilterBar } from './filter-bar.js'
import { QuickAddBar } from './quick-add-bar.js'
import type { SavedViewLayout } from '../api.js'

const TABS: ReadonlyArray<{ path: string; labelKey: string; layout: SavedViewLayout | 'archive' }> =
  [
    { path: '/work', labelKey: 'work.view.board', layout: 'people_board' },
    { path: '/work/table', labelKey: 'work.view.table', layout: 'table' },
    { path: '/work/timeline', labelKey: 'work.view.timeline', layout: 'timeline' },
    { path: '/work/calendar', labelKey: 'work.view.calendar', layout: 'calendar' },
    { path: '/work/mine', labelKey: 'work.view.mine', layout: 'mine' },
    { path: '/work/archive', labelKey: 'work.view.archive', layout: 'archive' },
  ]

export interface WorkShellProps {
  /** Omit to hide the filter bar (the archive view has its own member switcher instead). */
  filterLayout?: SavedViewLayout
  /** Omit to hide the quick-add bar (archive, and the full card page, have nothing to quick-add). */
  showQuickAdd?: boolean
  children: React.ReactNode
}

export function WorkShell({ filterLayout, showQuickAdd = true, children }: WorkShellProps) {
  const t = useT()
  const path = useRoutePath()
  const search = useSearchParams()
  const board = useBoardQuery()
  const qs = search.get('q')
  const searchSuffix = qs ? `?q=${encodeURIComponent(qs)}` : ''

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-h2 text-foreground">{t('work.title')}</h1>
        <nav className="flex flex-wrap gap-1" aria-label={t('work.title')}>
          {TABS.map((tab) => (
            <RouterLink
              key={tab.path}
              href={`${tab.path}${tab.layout === 'archive' ? '' : searchSuffix}`}
              className={cn(
                'rounded-sm px-3 py-1.5 text-small font-medium transition-colors duration-(--dur-micro)',
                path === tab.path
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              aria-current={path === tab.path ? 'page' : undefined}
            >
              {t(tab.labelKey)}
            </RouterLink>
          ))}
        </nav>
      </div>
      {showQuickAdd ? <QuickAddBar members={board.data?.members ?? []} /> : null}
      {filterLayout ? <FilterBar layout={filterLayout} /> : null}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}

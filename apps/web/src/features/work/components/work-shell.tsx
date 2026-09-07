// Shared chrome for every work-module route: the view-switcher tabs (Board/Table/Timeline/Calendar/
// Mine/Archive), the quick-add bar and the filter bar. One component so a filter typed on the board
// is still there after clicking over to Table (TECH-SPEC "table, timeline, calendar and mine show the
// same cards") -- the current `?q=` search string rides along on every tab link.
import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useT } from '@devon/i18n'
import { RouterLink, useRoutePath, useSearchParams } from '../../../lib/router.js'
import { useMediaQuery } from '../../../lib/use-media-query.js'
import { Collapsible, IconButton, PageHeader, cn } from '@devon/ui'
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

  // round2 SEV2: at 390 the chrome above the board (title, six tabs, quick-add, filter row,
  // "Kengaytirilgan") ate ~500px before any column started -- below 768 the quick-add bar and filter
  // row collapse behind one toggle in the header instead of always taking their own vertical space.
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [mobileChromeOpen, setMobileChromeOpen] = React.useState(false)
  const hasCollapsibleChrome = (showQuickAdd || Boolean(filterLayout)) && !isDesktop

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        eyebrow={t('work.eyebrow')}
        title={t('work.title')}
        description={t('work.description')}
        actions={
          hasCollapsibleChrome ? (
            <IconButton
              aria-label={t('work.filterChrome.toggle')}
              aria-expanded={mobileChromeOpen}
              aria-controls="work-shell-mobile-chrome"
              onClick={() => setMobileChromeOpen((v) => !v)}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </IconButton>
          ) : null
        }
        tabs={
          <nav className="flex flex-wrap gap-1 border-b border-border" aria-label={t('work.title')}>
            {TABS.map((tab) => (
              <RouterLink
                key={tab.path}
                href={`${tab.path}${tab.layout === 'archive' ? '' : searchSuffix}`}
                className={cn(
                  'relative -mb-px inline-flex min-h-11 items-center whitespace-nowrap px-3 text-body font-medium transition-colors duration-(--dur-micro)',
                  path === tab.path
                    ? 'border-b-2 border-primary text-foreground'
                    : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                )}
                aria-current={path === tab.path ? 'page' : undefined}
              >
                {t(tab.labelKey)}
              </RouterLink>
            ))}
          </nav>
        }
      />
      {isDesktop ? (
        <>
          {showQuickAdd ? <QuickAddBar members={board.data?.members ?? []} /> : null}
          {filterLayout ? <FilterBar layout={filterLayout} /> : null}
        </>
      ) : (
        <Collapsible id="work-shell-mobile-chrome" open={mobileChromeOpen}>
          <div className="flex flex-col gap-4">
            {showQuickAdd ? <QuickAddBar members={board.data?.members ?? []} /> : null}
            {filterLayout ? <FilterBar layout={filterLayout} /> : null}
          </div>
        </Collapsible>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}

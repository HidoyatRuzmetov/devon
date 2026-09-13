// Shared chrome for every work-module route: the view-switcher tabs (Board/Table/Timeline/Calendar/
// Mine/Archive), the quick-add bar and the filter bar. One component so a filter typed on the board
// is still there after clicking over to Table (TECH-SPEC "table, timeline, calendar and mine show the
// same cards") -- the current `?q=` search string rides along on every tab link.
import * as React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useT } from '@devon/i18n'
import { RouterLink, useRoutePath, useSearchParams } from '../../../lib/router.js'
import { useMediaQuery } from '../../../lib/use-media-query.js'
import {
  Collapsible,
  IconButton,
  PageHeader,
  PresenceAvatars,
  SegmentedControl,
  cn,
} from '@devon/ui'
import { replaceSearchParam } from '../../../lib/router.js'
import {
  LiveStatusPill,
  useCardSignalSource,
  usePresence,
  useRealtimeChannels,
} from '../../../lib/realtime/index.js'
import { useMeQuery } from '../../../lib/session.js'
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
  /**
   * v1.1 critique SEV2 #18: "two identical 'Hammasi | Mening' segmented controls sit on one screen".
   *
   * The board has its own, directly above the columns, and it carries the department's head-count
   * (`Hammasi 27`) -- information the shell's copy does not have and cannot get. So the board turns
   * this one off and keeps the one that says more. Every other work view keeps the shell's, which is
   * the only one it has.
   */
  hideMeControl?: boolean
  /** Omit to hide the quick-add bar (archive, and the full card page, have nothing to quick-add). */
  showQuickAdd?: boolean
  children: React.ReactNode
}

/** v1.1 SPEC §7 (A9) -- "Me mode": `assignee:@me` is a clause the filter grammar already
 * understands, so the toggle simply adds or removes that one token from `?q=`. Every view that reads
 * `q` (board, table, timeline, calendar) then filters without learning a second mechanism, and the
 * state survives a tab switch because it rides in the URL the tab links already carry. */
const ME_CLAUSE = 'assignee:@me'

function withoutMeClause(q: string): string {
  return q
    .split(/\s+/)
    .filter((token) => token.length > 0 && token !== ME_CLAUSE)
    .join(' ')
}

export function WorkShell({
  filterLayout,
  showQuickAdd = true,
  hideMeControl = false,
  children,
}: WorkShellProps) {
  const t = useT()
  const path = useRoutePath()
  const search = useSearchParams()
  const board = useBoardQuery()
  const qs = search.get('q')
  const searchSuffix = qs ? `?q=${encodeURIComponent(qs)}` : ''
  const meMode = (qs ?? '').split(/\s+/).includes(ME_CLAUSE)

  function setMeMode(next: 'all' | 'mine'): void {
    const rest = withoutMeClause(qs ?? '')
    const combined = next === 'mine' ? `${rest} ${ME_CLAUSE}`.trim() : rest
    replaceSearchParam('q', combined === '' ? null : combined)
  }

  // round2 SEV2: at 390 the chrome above the board (title, six tabs, quick-add, filter row,
  // "Kengaytirilgan") ate ~500px before any column started -- below 768 the quick-add bar and filter
  // row collapse behind one toggle in the header instead of always taking their own vertical space.
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [mobileChromeOpen, setMobileChromeOpen] = React.useState(false)
  const hasCollapsibleChrome = (showQuickAdd || Boolean(filterLayout)) && !isDesktop

  // v1.1 EPIC-018: who else is on this board right now, and whether what you are looking at is live
  // at all. Both come from `lib/realtime`, both degrade to nothing when Centrifugo is off -- the
  // pill then says so in words and the board keeps its four-second poll (see `hooks.ts`).
  //
  // The channel is the *department's* board channel, not one per view: Board, Table, Timeline and
  // Mine are four lenses on the same cards, so a colleague reading the table is as present to you as
  // one reading the board. Pretending otherwise would split a five-person department into six empty
  // rooms.
  const channels = useRealtimeChannels()
  const watchers = usePresence(channels?.board ?? null)
  // One subscription and one expiry timer for every "somebody is editing this" badge on the screen,
  // mounted here because this shell wraps all six work views (`lib/realtime/signals-store.ts`).
  const viewerId = useMeQuery().data?.user.id ?? null
  useCardSignalSource(channels?.board ?? null, viewerId)

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        eyebrow={t('work.eyebrow')}
        title={t('work.title')}
        description={t('work.description')}
        actions={
          <div className="flex items-center gap-2">
            <PresenceAvatars members={watchers} />
            <LiveStatusPill />
            {hasCollapsibleChrome ? (
              <IconButton
                aria-label={t('work.filterChrome.toggle')}
                aria-expanded={mobileChromeOpen}
                aria-controls="work-shell-mobile-chrome"
                onClick={() => setMobileChromeOpen((v) => !v)}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        }
        tabs={
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border">
            <nav className="flex flex-wrap gap-1" aria-label={t('work.title')}>
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
            {/* A9: "Mening" -- a visible segmented control on every work view, not a setting buried in
              a menu (WALKTHROUGH-FINDINGS 2.1's own complaint about the board's hidden me/everyone
              switch). `/work/mine` is already nothing but my cards, so it needs no toggle. */}
            {filterLayout && filterLayout !== 'mine' && !hideMeControl ? (
              <SegmentedControl
                size="sm"
                className="mb-1"
                value={meMode ? 'mine' : 'all'}
                onValueChange={setMeMode}
                label={t('work.board.scopeLabel')}
                options={[
                  { value: 'all', label: t('work.board.scopeAll') },
                  { value: 'mine', label: t('work.board.scopeMine') },
                ]}
              />
            ) : null}
          </div>
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

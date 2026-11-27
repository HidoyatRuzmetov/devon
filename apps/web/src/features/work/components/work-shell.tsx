import { useScopeTransition } from '../lib/use-scope-transition.js'
import { avatarUrl } from '../../../lib/avatar.js'
// Shared view-switcher tabs and presence for work routes. One component so a filter typed on the board
// is still there after clicking over to Table (TECH-SPEC "table, timeline, calendar and mine show the
// same cards") -- the current `?q=` search string rides along on every tab link.
import * as React from 'react'
import { CalendarDays, ChevronDown, Columns3, Table2, Timer, UserRound } from 'lucide-react'
import { useT } from '@devon/i18n'
import { returnContextParams } from '../../../lib/return-context.js'
import { navigate, RouterLink, useRoutePath, useSearchParams } from '../../../lib/router.js'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
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
import { useViewportBoundedHeight } from '../../../lib/use-viewport-bounded-height.js'
import type { WorkViewLayout } from '../api.js'

const TABS: ReadonlyArray<{ path: string; labelKey: string; layout: WorkViewLayout }> = [
  { path: '/work', labelKey: 'work.view.board', layout: 'people_board' },
  { path: '/work/table', labelKey: 'work.view.table', layout: 'table' },
  { path: '/work/timeline', labelKey: 'work.view.timeline', layout: 'timeline' },
  { path: '/work/calendar', labelKey: 'work.view.calendar', layout: 'calendar' },
  { path: '/work/person', labelKey: 'personWork.title', layout: 'mine' },
]

export interface WorkShellProps {
  /** Collection layout for the Me / Everyone control. Omit for a standalone card. */
  filterLayout?: WorkViewLayout
  /**
   * v1.1 critique SEV2 #18: "two identical 'Hammasi | Mening' segmented controls sit on one screen".
   *
   * The board has its own, directly above the columns, and it carries the department's head-count
   * (`Hammasi 27`) -- information the shell's copy does not have and cannot get. So the board turns
   * this one off and keeps the one that says more. Every other work view keeps the shell's, which is
   * the only one it has.
   */
  hideMeControl?: boolean
  /** View-specific controls share the view-switcher row on wide screens. */
  toolbar?: React.ReactNode
  viewAction?: React.ReactNode
  /** Phone controls sit beside a compact view switcher instead of compressing the desktop tabs. */
  mobileToolbar?: React.ReactNode
  /** Let the board consume the remaining viewport through CSS, including animated chrome. */
  fillViewport?: boolean
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
  hideMeControl = false,
  toolbar,
  viewAction,
  mobileToolbar,
  fillViewport = false,
  children,
}: WorkShellProps) {
  const t = useT()
  const [viewportRef, viewportHeight] = useViewportBoundedHeight<HTMLDivElement>(0, true)
  const path = useRoutePath()
  const search = useSearchParams()
  const qs = search.get('q')
  const viewParams = returnContextParams(search)
  if (qs) viewParams.set('q', qs)
  const searchSuffix = viewParams.size ? '?' + viewParams.toString() : ''
  const contentRef = React.useRef<HTMLDivElement>(null)
  const meMode = (qs ?? '').split(/\s+/).includes(ME_CLAUSE)
  const activeTab = TABS.find((tab) => tab.path === path) ?? TABS[0]!
  const viewIcons = [Columns3, Table2, Timer, CalendarDays, UserRound]
  const ActiveViewIcon = viewIcons[TABS.indexOf(activeTab)] ?? Columns3

  function setMeMode(next: 'all' | 'mine'): void {
    const rest = withoutMeClause(qs ?? '')
    const combined = next === 'mine' ? `${rest} ${ME_CLAUSE}`.trim() : rest
    replaceSearchParam('q', combined === '' ? null : combined)
  }

  const changeMeMode = useScopeTransition(meMode ? 'mine' : 'all', setMeMode, contentRef)

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
    <div
      ref={fillViewport ? viewportRef : undefined}
      className="flex min-h-0 flex-col"
      style={fillViewport ? { height: viewportHeight } : undefined}
    >
      <PageHeader
        className="shrink-0"
        compact
        title={t('work.title')}
        actions={
          <div className="flex items-center gap-2">
            <PresenceAvatars
              members={watchers.map((member) => ({
                ...member,
                src: avatarUrl(member.avatarKey, 64),
              }))}
            />
            <LiveStatusPill />
          </div>
        }
        tabs={
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border">
            <div className="flex min-w-0 basis-full items-center justify-between gap-2 pb-1 md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    className="min-h-11 gap-2"
                    aria-label={t('boardRefinement.mobile.view', { view: t(activeTab.labelKey) })}
                  >
                    <ActiveViewIcon className="size-4" aria-hidden="true" />
                    {t(activeTab.labelKey)}
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={activeTab.path}
                    onValueChange={(next) => navigate(`${next}${searchSuffix}`)}
                  >
                    {TABS.map((tab, index) => {
                      const ViewIcon = viewIcons[index] ?? Columns3
                      return (
                        <DropdownMenuRadioItem key={tab.path} value={tab.path}>
                          <ViewIcon className="mr-2 size-4" aria-hidden="true" />
                          {t(tab.labelKey)}
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {viewAction}
              {mobileToolbar}
            </div>
            <nav
              className="hidden min-w-0 basis-full gap-0 overflow-x-auto overflow-y-hidden md:flex xl:basis-auto xl:flex-1"
              aria-label={t('work.title')}
            >
              {TABS.map((tab) => (
                <RouterLink
                  key={tab.path}
                  href={`${tab.path}${searchSuffix}`}
                  className={cn(
                    'relative -mb-px inline-flex min-h-11 items-center whitespace-nowrap px-2 text-small font-medium transition-colors duration-(--dur-micro)',
                    path === tab.path
                      ? 'border-b-2 border-primary text-foreground'
                      : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  aria-current={path === tab.path ? 'page' : undefined}
                >
                  {t(tab.labelKey)}
                </RouterLink>
              ))}
              <div className="ml-2 flex shrink-0 items-center">{viewAction}</div>
            </nav>
            {toolbar}
            {/* A9: "Mening" -- a visible segmented control on every work view, not a setting buried in
              a menu (WALKTHROUGH-FINDINGS 2.1's own complaint about the board's hidden me/everyone
              switch). `/work/mine` is already nothing but my cards, so it needs no toggle. */}
            {filterLayout && filterLayout !== 'mine' && !hideMeControl ? (
              <SegmentedControl
                size="sm"
                className="mb-1"
                value={meMode ? 'mine' : 'all'}
                onValueChange={(next) => void changeMeMode(next)}
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
      <div ref={contentRef} className={cn('mt-2 min-h-0', fillViewport && 'flex-1')}>
        {children}
      </div>
    </div>
  )
}

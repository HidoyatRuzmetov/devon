// The boshqarma boshligʻi's Home (v1.1 SPEC §3.2) -- the answer to CTO finding #2: the head's home is
// for *management* (people, load, risk, decisions), the member's home is for *working*. Same shell,
// two products.
//
// Every number here is real and comes from an endpoint that already exists: the department board
// (one request that already groups every card by the person who holds it), the shared
// people-indicator service (SPEC §4.2, head-only), the analytics summary and the head's own personal
// overview. Nothing is mocked and nothing is a dashed "coming soon" box -- a management dashboard
// that lies once is never trusted again.
//
// Every tile drills somewhere specific (SPEC §3.2): a person's name opens their person page, an
// overdue count opens the people table already filtered to overdue work, a card opens the card, load
// opens the table sorted by load. A tile whose number you cannot act on is a poster, not a dashboard.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatDate, formatDateTime, formatNumber } from '@devon/i18n'
import {
  DEFAULT_PEOPLE_VIEW_CONFIG,
  PEOPLE_VIEW_URL_PARAM,
  encodePeopleViewConfig,
  type IndicatorKey,
  type PeopleViewConfig,
} from '@devon/contracts'
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Reveal,
  Skeleton,
  SparkleButton,
  Stagger,
  StaggerItem,
  StatNumber,
  toast,
  StateView,
  cn,
  initialsFromName,
} from '@devon/ui'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Flame,
  Gavel,
  LayoutGrid,
  Sparkle,
  Sparkles,
  Target,
  Users2,
} from 'lucide-react'
import { navigate, RouterLink } from '../../lib/router.js'
import { avatarUrl } from '../../lib/avatar.js'
import { useSession, useDepartment } from '../../lib/session.js'
import { fetchMembers, type Member } from '../structure/api.js'
import { fetchIndicators } from '../people/api.js'
import { personPath } from '../people/routes.js'
import { fetchBoard, type Card as WorkCard } from '../work/api.js'
import { useGoalsQuery } from '../work/hooks-plus.js'
import {
  GOAL_METRIC_LABEL_KEYS,
  goalBarFill,
  goalProgressTone,
  isCeilingMetric,
  isPercentMetric,
} from '../work/lib/goal-format.js'
import { useBriefingQuery, useRefreshBriefingMutation } from '../ai/use-ai.js'
import { CatchUpPreview } from '../ai/components/previews.js'
import { parseFeatureOutput, type CatchUpOutput } from '../ai/outputs.js'
import { usePersonalOverviewQuery, useSummaryQuery } from '../analytics/use-analytics.js'

/** The indicator keys this dashboard asks for. Narrow on purpose: the service runs one query per
 * source it is actually asked about, so a six-tile dashboard costs three statements. */
const DASHBOARD_KEYS: readonly IndicatorKey[] = [
  'overdueCards',
  'openCards',
  'workloadPct',
  'onboardingPct',
  'joinedAt',
]

/** A drill-down into the people table that arrives already arranged for the question the tile asked.
 * The table reads exactly this shape back out of the URL (`features/people/routes.ts` and
 * `PEOPLE_VIEW_URL_PARAM`), so a tile and the table can never disagree about what "overdue by
 * person" means. */
function tablePath(patch: Partial<PeopleViewConfig>): string {
  const config: PeopleViewConfig = { ...DEFAULT_PEOPLE_VIEW_CONFIG, ...patch }
  return `/people/table?${PEOPLE_VIEW_URL_PARAM}=${encodeURIComponent(encodePeopleViewConfig(config))}`
}

export type HeadDashboardTile = {
  id: string
  titleKey: string
  /** One line saying what the number means -- never a bare number on a management screen. */
  meaningKey: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  onOpen: () => void
  ctaKey: string
}

function TileShell({
  tile,
  tone = 'neutral',
  /** v1.1 critique SEV1 #4: the tile's own headline number, when it has one. The Kechikayotgan tile
   * used to render only its top five people, so the department's real overdue total -- the number
   * the AI briefing quoted back -- appeared nowhere on the dashboard and the two read as a
   * contradiction. A tile that drives a sentence has to print the number in that sentence. */
  value,
  children,
}: {
  tile: Pick<HeadDashboardTile, 'titleKey' | 'meaningKey' | 'icon' | 'onOpen' | 'ctaKey'>
  tone?: 'neutral' | 'attention'
  value?: number
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const Icon = tile.icon
  return (
    <Card
      elevation="flat"
      className={cn(
        'flex h-full flex-col gap-3',
        tone === 'attention' && 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
        <h3 className="text-small font-medium text-foreground">{t(tile.titleKey)}</h3>
        {value !== undefined ? (
          <span className="ml-auto text-h3 font-semibold tabular-nums text-foreground">
            <StatNumber value={value} locale={locale} />
          </span>
        ) : null}
      </div>
      {children}
      <p className="text-caption text-muted-foreground">{t(tile.meaningKey)}</p>
      <button
        type="button"
        onClick={tile.onOpen}
        className="mt-auto self-start rounded-sm text-small font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t(tile.ctaKey)}
      </button>
    </Card>
  )
}

/** A person row that goes where a person row should go: their page (SPEC §3.2 "people at risk →
 * person page", "onboarding in progress → person pages"). */
function PersonRow({
  member,
  right,
}: {
  member: Member
  right: React.ReactNode
}): React.JSX.Element {
  const name = `${member.givenName} ${member.familyName}`.trim()
  const href = personPath(member.userId)
  return (
    <li>
      <a
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          navigate(href)
        }}
        className="flex min-h-9 items-center gap-2 rounded-sm px-1 transition-colors duration-(--dur-micro) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar
          size="sm"
          alt={name}
          // SEV2 #21: the name is rendered as text one element away, so the avatar's own screen-
          // reader label made every tile row read "Farrux Saidov Farrux Saidov 7".
          decorative
          hueSeed={member.userId}
          initials={initialsFromName(member.givenName, member.familyName)}
          src={avatarUrl(member.avatarKey, 64)}
        />
        <span className="min-w-0 flex-1 truncate text-small">{name}</span>
        {right}
      </a>
    </li>
  )
}

function CardRow({
  card,
  tone,
}: {
  card: WorkCard
  tone: 'danger' | 'warning'
}): React.JSX.Element {
  const locale = useLocale()
  const href = `/work?card=${card.id}`
  return (
    <li>
      <a
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          navigate(href)
        }}
        className="flex min-h-9 items-center gap-2 rounded-sm px-1 transition-colors duration-(--dur-micro) hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-small">{card.title}</span>
        {card.dueAt ? (
          <span
            className={cn(
              'shrink-0 tabular-nums text-caption',
              tone === 'danger' ? 'text-destructive' : 'text-warning',
            )}
          >
            {formatDate(new Date(card.dueAt), locale)}
          </span>
        ) : null}
      </a>
    </li>
  )
}

/**
 * SPEC §3.2: "An arrangeable layout (drag tiles, hide tiles; persisted per head)."
 *
 * Order and visibility, per signed-in head, remembered on that head's own machine. Stored as ids
 * rather than positions so a tile added in a later round appears (at the end) instead of silently
 * vanishing for everyone who has ever arranged their dashboard -- and an id this build no longer
 * knows is dropped on read rather than rendering a hole.
 */
const HEAD_TILE_IDS = [
  'decisions',
  'overdue',
  'risk',
  'load',
  'projects',
  'events',
  'onboarding',
  // v1.1 integration (HANDOFFS #6): SPEC §3.2 names these two in the tile order and the wave left
  // them to the goals and AI packages, neither of which owns this file. A head who arranged their
  // dashboard before this build keeps their arrangement -- `useHeadLayout` appends an id it has not
  // seen rather than dropping it.
  'goals',
  'catchUp',
] as const
type HeadTileId = (typeof HEAD_TILE_IDS)[number]

type HeadLayout = { order: HeadTileId[]; hidden: HeadTileId[]; visible: HeadTileId[] }

/**
 * v1.1 recapture report §1a #23. This tile used to run `catch_up` synchronously and hold the head
 * on a spinner: the call takes 78-276 seconds against the ministry's GLM, the fix round put a 75 s
 * budget on it, and every run after that ended in "AI did not answer in time".
 *
 * Nothing here waits on a model any more. `GET /ai/briefing` returns whatever the nightly job last
 * produced -- in milliseconds, with the time it was generated -- and "Yangilash" enqueues a new run
 * the tile reports on quietly while the old briefing stays readable. The whole mechanism is
 * `apps/api/src/modules/ai/briefing.ts`.
 */

function useHeadLayout(userId: string | undefined): {
  layout: HeadLayout
  move: (id: HeadTileId, delta: -1 | 1) => void
  toggle: (id: HeadTileId) => void
  reset: () => void
} {
  const key = `devon.home.head.layout.${userId ?? 'anon'}`
  const [state, setState] = React.useState<{ order: HeadTileId[]; hidden: HeadTileId[] }>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return { order: [...HEAD_TILE_IDS], hidden: [] }
      const parsed = JSON.parse(raw) as { order?: string[]; hidden?: string[] }
      const known = (list: string[] | undefined): HeadTileId[] =>
        (list ?? []).filter((id): id is HeadTileId =>
          (HEAD_TILE_IDS as readonly string[]).includes(id),
        )
      const order = known(parsed.order)
      // Anything this build knows that the stored order does not mention is new: append it.
      for (const id of HEAD_TILE_IDS) if (!order.includes(id)) order.push(id)
      return { order, hidden: known(parsed.hidden) }
    } catch {
      return { order: [...HEAD_TILE_IDS], hidden: [] }
    }
  })

  const persist = React.useCallback(
    (next: { order: HeadTileId[]; hidden: HeadTileId[] }) => {
      setState(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Best-effort: a private window still gets the arrangement for this session.
      }
    },
    [key],
  )

  const move = React.useCallback(
    (id: HeadTileId, delta: -1 | 1) => {
      const order = [...state.order]
      const index = order.indexOf(id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= order.length) return
      const [removed] = order.splice(index, 1)
      order.splice(target, 0, removed!)
      persist({ order, hidden: state.hidden })
    },
    [state, persist],
  )

  const toggle = React.useCallback(
    (id: HeadTileId) => {
      const hidden = state.hidden.includes(id)
        ? state.hidden.filter((x) => x !== id)
        : [...state.hidden, id]
      persist({ order: state.order, hidden })
    },
    [state, persist],
  )

  const reset = React.useCallback(
    () => persist({ order: [...HEAD_TILE_IDS], hidden: [] }),
    [persist],
  )

  const visible = state.order.filter((id) => !state.hidden.includes(id))
  return { layout: { ...state, visible }, move, toggle, reset }
}

export function HeadDashboard(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const session = useSession()
  const { departmentId } = useDepartment()
  const { layout, move, toggle, reset } = useHeadLayout(session.user?.id)

  const membersQuery = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: departmentId !== null,
  })
  const indicatorsQuery = useQuery({
    queryKey: ['people', 'indicators', departmentId, DASHBOARD_KEYS.join(',')],
    queryFn: () => fetchIndicators([...DASHBOARD_KEYS]),
    enabled: departmentId !== null,
  })
  const boardQuery = useQuery({
    queryKey: ['work', 'board'],
    queryFn: fetchBoard,
    enabled: departmentId !== null,
  })
  const summaryQuery = useSummaryQuery({})
  const overviewQuery = usePersonalOverviewQuery()
  // SPEC §3.2's last two tiles. Goals are a plain query -- they are computed from the cards the
  // department already has and cost one statement. The briefing is *not*: an AI call costs money, so
  // it runs when the head asks for it and never on page load (AI-AUDIT §5, "no feature spends a
  // budget nobody asked it to").
  const goalsQuery = useGoalsQuery()
  // The cached briefing. One row, read on every Home render and polled only while a refresh is
  // actually in flight (`useBriefingQuery`) -- never a model call on the request path.
  const briefingQuery = useBriefingQuery(true)
  const refreshBriefing = useRefreshBriefingMutation()
  const briefing = briefingQuery.data?.briefing ?? null
  const briefingOutput = briefing?.data
    ? parseFeatureOutput<CatchUpOutput>('catch_up', briefing.data)
    : null
  const briefingPending =
    briefing?.status === 'queued' || briefing?.status === 'running' || refreshBriefing.isPending

  // `goalsQuery` is deliberately absent: a dashboard must not withhold six tiles while a seventh
  // loads. Its own tile renders a skeleton.
  const pending =
    membersQuery.isPending ||
    indicatorsQuery.isPending ||
    summaryQuery.isPending ||
    overviewQuery.isPending

  if (pending) return <StateView kind="loading" titleKey="state.loading" />

  const failed =
    membersQuery.isError || indicatorsQuery.isError || summaryQuery.isError || overviewQuery.isError
  if (failed) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            void indicatorsQuery.refetch()
            void summaryQuery.refetch()
            void boardQuery.refetch()
          },
        }}
      />
    )
  }

  const members = membersQuery.data ?? []
  const rows = indicatorsQuery.data?.people ?? []
  const capacity = indicatorsQuery.data?.capacityCards ?? 8
  const summary = summaryQuery.data
  const overview = overviewQuery.data

  const allCards: WorkCard[] = [
    ...(boardQuery.data?.columns ?? []).flatMap((column) => column.cards),
    ...(boardQuery.data?.unassigned ?? []),
  ]

  const num = (userId: string, key: IndicatorKey): number =>
    Number(rows.find((r) => r.userId === userId)?.values[key] ?? 0)

  const overdueByPerson = members
    .map((member) => ({ member, overdue: num(member.userId, 'overdueCards') }))
    .filter((row) => row.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, 5)

  const loadThisWeek = members
    .map((member) => ({
      member,
      pct: num(member.userId, 'workloadPct'),
      open: num(member.userId, 'openCards'),
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5)

  const onboarding = members
    .map((member) => ({ member, pct: num(member.userId, 'onboardingPct') }))
    .filter((row) => row.pct !== 100)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 4)

  const slippingProjects = [...(summary?.projectProgress ?? [])]
    .sort((a, b) => a.progress - b.progress)
    .slice(0, 4)

  const now = Date.now()
  const SEVEN_DAYS_MS = 7 * 86_400_000
  const upcomingEvents: NonNullable<typeof summary>['eventsParticipation'] = []
  for (const event of summary?.eventsParticipation ?? []) {
    const startsIn = new Date(event.startsAt).getTime() - now
    if (startsIn < 0) continue
    if (startsIn > SEVEN_DAYS_MS) continue
    upcomingEvents.push(event)
    if (upcomingEvents.length === 4) break
  }

  // "Qaror kutmoqda": work this head gave out that has run past its date. The head is the only
  // person who can move it, extend it or take it back -- which is exactly what a decision is.
  const decisionCards = allCards
    .filter((card) => card.giverUserId === session.user?.id && card.risk === 'overdue')
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
    .slice(0, 5)
  const decisionsWaiting = Math.max(decisionCards.length, overview?.givenOverdueCount ?? 0)

  // "Xavf ostida": everything in the department due within two days that is not finished. The board
  // computes this risk once, server-side, and the tile never re-decides it.
  const atRiskCards = allCards
    .filter((card) => card.risk === 'at_risk')
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
    .slice(0, 5)

  const totalOverdue = members.reduce((sum, member) => sum + num(member.userId, 'overdueCards'), 0)
  const overloaded = loadThisWeek.filter((row) => row.pct >= 100).length

  /**
   * v1.1 critique SEV1 #4, and why it stays fixed now that the briefing is computed server-side.
   *
   * The briefing returned "За прошедшую неделю не закрыто ни одной задачи — без изменений по
   * сравнению с предыдущей неделей. В управлении 77 просроченных задач." while the Maqsadlar tile
   * three inches to its left read "82/120". The 77 was the department's true overdue total,
   * computed here and then never rendered -- the Kechikayotgan tile showed only its top five
   * people, so the only number a head could compare the briefing against was 31. The briefing was
   * right and looked wrong.
   *
   * `totalOverdue` is therefore on the tile, and it is the same question `repo.ts`'s
   * `departmentWeekSnapshot` answers for the briefing job: every active card in the department
   * whose due date has passed. The window and the counts live in one place per side now -- this
   * screen renders them, the job feeds them to the model -- and `catch-up.golden.test.ts` pins the
   * headline the prompt produces from a fixed fixture, so the two cannot drift apart silently.
   */

  // Goals worth a dashboard row: not archived, most-behind first, at most three. A head who set
  // eight goals does not want eight bars on Home -- `/goals` is where all of them live.
  const activeGoals = [...(goalsQuery.data ?? [])]
    .filter((goal) => goal.archivedAt === null)
    .sort((a, b) => a.progress - b.progress)
    .slice(0, 3)

  const cardTitleById = (id: string): string | null =>
    allCards.find((card) => card.id === id)?.title ?? null

  /** Every tile, by id. The map is built unconditionally (each one is cheap JSX over data this
   * component already has); `layout` decides which of them reach the grid. */
  const tiles: Record<HeadTileId, React.ReactNode> = {
    decisions: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.decisions.title',
            meaningKey: 'home.head.decisions.meaning',
            icon: Gavel,
            ctaKey: 'home.head.decisions.cta',
            onOpen: () => navigate('/work?mine=given'),
          }}
          tone={decisionsWaiting > 0 ? 'attention' : 'neutral'}
        >
          <p className="font-display text-h1 tabular-nums">
            <StatNumber value={decisionsWaiting} locale={locale} />
          </p>
          {decisionCards.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.decisions.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {decisionCards.map((card) => (
                <CardRow key={card.id} card={card} tone="danger" />
              ))}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    overdue: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.overdue.title',
            meaningKey: 'home.head.overdue.meaning',
            icon: AlertTriangle,
            ctaKey: 'home.head.overdue.cta',
            onOpen: () =>
              navigate(
                tablePath({
                  columns: ['unit', 'overdueCards', 'openCards', 'workloadPct'],
                  sort: { columnId: 'overdueCards', desc: true },
                  filters: [{ columnId: 'overdueCards', op: 'gte', value: 1 }],
                  groupBy: 'none',
                }),
              ),
          }}
          tone={totalOverdue > 0 ? 'attention' : 'neutral'}
          // SEV1 #4: the department's true overdue total, on the tile, so the AI briefing's own
          // "N kechikkan" has something on screen to agree with. The list below is still the top
          // five people; the number is the whole boshqarma.
          value={totalOverdue}
        >
          {overdueByPerson.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.overdue.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {overdueByPerson.map(({ member, overdue }) => (
                <PersonRow
                  key={member.userId}
                  member={member}
                  right={
                    <span className="tabular-nums text-small font-medium text-destructive">
                      {formatNumber(overdue, locale)}
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    risk: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.risk.title',
            meaningKey: 'home.head.risk.meaning',
            icon: Flame,
            ctaKey: 'home.head.risk.cta',
            onOpen: () => navigate('/work'),
          }}
          tone={atRiskCards.length > 0 ? 'attention' : 'neutral'}
          value={atRiskCards.length}
        >
          {atRiskCards.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.risk.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {atRiskCards.map((card) => (
                <CardRow key={card.id} card={card} tone="warning" />
              ))}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    load: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.load.title',
            meaningKey: 'home.head.load.meaning',
            icon: Users2,
            ctaKey: 'home.head.load.cta',
            onOpen: () =>
              navigate(
                tablePath({
                  columns: ['unit', 'workloadPct', 'openCards', 'dueThisWeek'],
                  sort: { columnId: 'workloadPct', desc: true },
                  groupBy: 'none',
                }),
              ),
          }}
          tone={overloaded > 0 ? 'attention' : 'neutral'}
        >
          {loadThisWeek.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.load.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {loadThisWeek.map(({ member, pct, open }) => (
                <PersonRow
                  key={member.userId}
                  member={member}
                  right={
                    <span className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            'block h-full rounded-full',
                            pct >= 100 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-primary',
                          )}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </span>
                      <span
                        className="tabular-nums text-small text-muted-foreground"
                        title={t('people.table.workload.value', { open, capacity })}
                      >
                        {pct}%
                      </span>
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    projects: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.projects.title',
            meaningKey: 'home.head.projects.meaning',
            icon: Sparkle,
            ctaKey: 'home.head.projects.cta',
            onOpen: () => navigate('/projects'),
          }}
        >
          {slippingProjects.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.projects.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {slippingProjects.map((project) => {
                // `progress` is a 0..1 ratio, exactly as `analytics/sections.tsx` reads it. Rounding
                // it without the x100 is what made every project on this dashboard read "0%" while
                // the analytics chart, from the same field of the same response, read 33-44%.
                const percent = Math.round(project.progress * 100)
                return (
                  <li key={project.id} className="flex flex-col gap-1">
                    <RouterLink
                      href={`/projects/view?id=${encodeURIComponent(project.id)}`}
                      className="flex items-baseline justify-between gap-2 rounded-sm hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0 truncate text-small">{project.title}</span>
                      <span className="tabular-nums text-caption text-muted-foreground">
                        {formatNumber(percent, locale)}%
                      </span>
                    </RouterLink>
                    <Progress
                      value={percent}
                      label={t('home.head.projects.progressAria', { title: project.title })}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    events: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.events.title',
            meaningKey: 'home.head.events.meaning',
            icon: CalendarDays,
            ctaKey: 'home.head.events.cta',
            onOpen: () => navigate('/events'),
          }}
        >
          {upcomingEvents.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.events.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {upcomingEvents.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-small">{event.title}</span>
                  <span className="tabular-nums text-caption text-muted-foreground">
                    {formatNumber(event.yes, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    onboarding: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.onboarding.title',
            meaningKey: 'home.head.onboarding.meaning',
            icon: Users2,
            ctaKey: 'home.head.onboarding.cta',
            onOpen: () =>
              navigate(
                tablePath({
                  columns: ['unit', 'onboardingPct', 'joinedAt', 'telegramLinked'],
                  sort: { columnId: 'onboardingPct', desc: false },
                  filters: [{ columnId: 'onboardingPct', op: 'lte', value: 99 }],
                  groupBy: 'none',
                }),
              ),
          }}
        >
          {onboarding.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.onboarding.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {onboarding.map(({ member, pct }) => (
                <PersonRow
                  key={member.userId}
                  member={member}
                  right={
                    <span className="tabular-nums text-small text-muted-foreground">{pct}%</span>
                  }
                />
              ))}
            </ul>
          )}
        </TileShell>
      </StaggerItem>
    ),
    goals: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.goals.title',
            meaningKey: 'home.head.goals.meaning',
            icon: Target,
            ctaKey: 'home.head.goals.cta',
            onOpen: () => navigate('/goals'),
          }}
        >
          {goalsQuery.isPending ? (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : null}
          {!goalsQuery.isPending && activeGoals.length === 0 ? (
            <p className="text-small text-muted-foreground">{t('home.head.goals.empty')}</p>
          ) : null}
          {!goalsQuery.isPending && activeGoals.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {activeGoals.map((goal) => (
                <li key={goal.id} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-small">{goal.title}</span>
                    {/* v1.1 recapture §1a #8: the tile said "100%" where `/goals` said
                        "98% (maqsad: 85%)", and "78% chegaradan" where the page said
                        "chegaraning 78%" -- the same goal, two numbers and two sentences, three
                        inches apart. The tile now reads the goal the way the page does, from the
                        same helpers and the same `work.goals.*` keys:
                          - a percentage metric prints its own value against its own target,
                            never progress-toward-target clamped at 100;
                          - a ceiling prints how much of the cap is used, in the page's words;
                          - a count prints "current / target".
                        One phrasing, one number, wherever a head happens to be looking. */}
                    <span className="shrink-0 tabular-nums text-caption text-muted-foreground">
                      {isPercentMetric(goal.metric)
                        ? `${formatNumber(goal.currentValue, locale)}% ${t('work.goals.percentTarget', { target: goal.targetValue })}`
                        : isCeilingMetric(goal.metric)
                          ? t('work.goals.capUsed', {
                              pct: Math.round(
                                goalBarFill(goal.metric, goal.currentValue, goal.targetValue) * 100,
                              ),
                            })
                          : t('work.goals.value', {
                              current: goal.currentValue,
                              target: goal.targetValue,
                            })}
                    </span>
                  </span>
                  <Progress
                    value={Math.round(
                      goalBarFill(goal.metric, goal.currentValue, goal.targetValue) * 100,
                    )}
                    tone={goalProgressTone(goal.metric, goal.currentValue, goal.targetValue)}
                    label={t('home.head.goals.progressAria', { title: goal.title })}
                  />
                  <span className="text-caption text-muted-foreground">
                    {t(GOAL_METRIC_LABEL_KEYS[goal.metric])}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </TileShell>
      </StaggerItem>
    ),
    catchUp: (
      <StaggerItem className="h-full">
        <TileShell
          tile={{
            titleKey: 'home.head.catchUp.title',
            meaningKey: 'home.head.catchUp.meaning',
            icon: Sparkles,
            ctaKey: 'home.head.catchUp.cta',
            onOpen: () => navigate('/ai'),
          }}
        >
          {briefingQuery.isPending ? (
            // I-10: the tile has a loading state of its own shape, not a spinner in a box.
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              {briefingOutput ? (
                <CatchUpPreview output={briefingOutput} cardTitle={cardTitleById} />
              ) : (
                <p className="text-small text-muted-foreground">
                  {briefing?.status === 'failed'
                    ? t('home.head.catchUp.failed')
                    : t('home.head.catchUp.empty')}
                </p>
              )}

              {/* The quiet in-flight state the finding asked for: a line, not a takeover. The words
                  already on screen stay readable while the new ones are being made -- a head who
                  presses Yangilash has not asked to stop reading. */}
              {briefingPending ? (
                <p
                  className="flex items-center gap-2 text-small text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <Sparkle className="size-4 animate-pulse" aria-hidden="true" />
                  <span>
                    {t('home.head.catchUp.pending')} — {t('home.head.catchUp.pendingHint')}
                  </span>
                </p>
              ) : null}

              {/* How old the words are, always, whenever there are words. A briefing without a
                  timestamp invites a head to read Friday's week as this morning's. */}
              {briefing?.generatedAt ? (
                <p className="text-caption text-muted-foreground">
                  {t('home.head.catchUp.generatedAt', {
                    time: formatDateTime(new Date(briefing.generatedAt), locale),
                  })}
                </p>
              ) : null}

              {briefingQuery.data?.canRefresh ? (
                <SparkleButton
                  size="sm"
                  label={t('home.head.catchUp.refresh')}
                  aria-label={t('home.head.catchUp.refresh')}
                  disabled={briefingPending}
                  onClick={() => {
                    refreshBriefing.mutate(locale, {
                      onSuccess: (res) => {
                        // The server refuses inside the cooldown rather than spending the
                        // department's soʻm twice on one unchanged week; it hands back how long is
                        // left, so the toast can say something true.
                        toast(
                          res.retryAfterMs === null
                            ? t('home.head.catchUp.requested')
                            : t('home.head.catchUp.cooldown'),
                        )
                      },
                      onError: () => toast(t('home.head.catchUp.failed')),
                    })
                  }}
                />
              ) : null}
            </div>
          )}
        </TileShell>
      </StaggerItem>
    ),
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
            {t('home.head.section')}
          </h2>
          <TileArranger
            order={layout.order}
            hidden={layout.hidden}
            onMove={move}
            onToggle={toggle}
            onReset={reset}
          />
        </div>

        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {/* SPEC §3.2: "An arrangeable layout (drag tiles, hide tiles; persisted per head)."
              Each tile is an entry in this map, and `layout` decides the order and what is on
              screen -- so the head's arrangement is data, not a hard-coded sequence of JSX. */}
          {layout.visible.map((id) => (
            <React.Fragment key={id}>{tiles[id]}</React.Fragment>
          ))}
        </Stagger>
        {layout.visible.length === 0 ? (
          <StateView
            kind="empty"
            titleKey="home.head.arrange.allHidden.title"
            bodyKey="home.head.arrange.allHidden.body"
            action={{ labelKey: 'home.head.arrange.reset', onAction: reset }}
          />
        ) : null}
      </section>

      <Reveal>
        <p className="text-caption text-muted-foreground">{t('home.head.drillNote')}</p>
      </Reveal>
    </div>
  )
}

/** The arrange control (SPEC §3.2). Move-up / move-down buttons and a checkbox per tile rather than
 * drag alone: a head rearranges this once, often from a keyboard on a government laptop, and every
 * primary flow in this product has a keyboard path (DESIGN.md §6). */
function TileArranger({
  order,
  hidden,
  onMove,
  onToggle,
  onReset,
}: {
  order: readonly HeadTileId[]
  hidden: readonly HeadTileId[]
  onMove: (id: HeadTileId, delta: -1 | 1) => void
  onToggle: (id: HeadTileId) => void
  onReset: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <LayoutGrid aria-hidden="true" className="size-4" />
          {t('home.head.arrange.action')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-2">
        <p className="text-small font-medium">{t('home.head.arrange.heading')}</p>
        <p className="text-caption text-muted-foreground">{t('home.head.arrange.hint')}</p>
        <ul className="flex flex-col gap-1">
          {order.map((id, index) => {
            const name = t(`home.head.${id}.title`)
            return (
              <li
                key={id}
                className="flex min-h-11 items-center gap-2 rounded-sm border border-border px-2 py-1"
              >
                <Checkbox
                  id={`head-tile-${id}`}
                  checked={!hidden.includes(id)}
                  onCheckedChange={() => onToggle(id)}
                  aria-label={t('home.head.arrange.show', { name })}
                />
                <label htmlFor={`head-tile-${id}`} className="min-w-0 flex-1 truncate text-small">
                  {name}
                </label>
                <IconButton
                  aria-label={t('home.head.arrange.moveUp', { name })}
                  disabled={index === 0}
                  onClick={() => onMove(id, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </IconButton>
                <IconButton
                  aria-label={t('home.head.arrange.moveDown', { name })}
                  disabled={index === order.length - 1}
                  onClick={() => onMove(id, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </IconButton>
              </li>
            )
          })}
        </ul>
        <Button variant="secondary" size="sm" onClick={onReset}>
          {t('home.head.arrange.reset')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** The shape the head-console package's own tiles receive when it extends `HEAD_TILES`
 * (SPEC §13, wave 3): the department's members, already loaded, keyed by id. */
export type HeadDashboardData = {
  members: Map<string, Member>
}

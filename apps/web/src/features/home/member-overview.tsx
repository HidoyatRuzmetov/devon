import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  ProgressRing,
  StateView,
  cn,
  initialsFromName,
  strikethroughClass,
} from '@devon/ui'
import {
  Archive,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  Circle,
  CircleDot,
  FolderKanban,
  Users,
  X,
} from 'lucide-react'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { RouterLink } from '../../lib/router.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { avatarUrl } from '../../lib/avatar.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import { fetchMembers, fetchUnitsOverview } from '../structure/api.js'
import { fetchPersonalOverview } from '../analytics/api.js'
import { fetchCards, type Card } from '../work/api.js'
import { ArchivedCardBadge } from '../work/components/archived-card-badge.js'
import { openCardPeek } from '../work/lib/open-card-peek.js'
import { isCardCompleted, PRIORITY_ORDER } from '../work/lib/format.js'
import { useProjectsQuery } from '../projects/hooks.js'
import { useEventsQuery } from '../events/hooks.js'
import { HomeWorkspace, HOME_METRIC_INTERACTION } from './home-workspace.js'

const drill = (path: string) => `${path}${path.includes('?') ? '&' : '?'}from=overview`
export type WorkCategory = 'individual' | 'projects' | 'done' | 'archived'
type ActiveStage = 'all' | 'todo' | 'in_progress'

/** Follow the real API cursor: counts and deadlines must not silently stop at the first 100 cards.
 * Only the viewer's assignments are loaded. Cancellation prevents a departed account from fetching
 * more pages; the scoped query key prevents a late response appearing in another account. */
export async function fetchMemberHomeCards(signal?: AbortSignal): Promise<Card[]> {
  const items: Card[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    signal?.throwIfAborted()
    const page = await fetchCards({ q: 'assignee:@me', limit: 100, cursor })
    items.push(...page.items)
    if (!page.nextCursor) break
    if (seen.has(page.nextCursor)) throw new Error('Repeated card cursor')
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)
  signal?.throwIfAborted()
  return [...new Map(items.map((card) => [card.id, card])).values()]
}

export function sortMemberTasks(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const date =
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)
    if (Number.isFinite(date) && date !== 0) return date
    if (a.dueAt && !b.dueAt) return -1
    if (!a.dueAt && b.dueAt) return 1
    return (
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
      a.orderKey.localeCompare(b.orderKey)
    )
  })
}

function MemberTask({ card, projectTitle }: { card: Card; projectTitle?: string | undefined }) {
  const t = useT(),
    locale = useLocale()
  const done = isCardCompleted(card)
  const progress = card.checklistTotal
    ? Math.round((card.checklistDone / card.checklistTotal) * 100)
    : done
      ? 100
      : 0
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-2.5 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/30',
        card.projectId ? 'bg-accent/45' : 'bg-card',
      )}
    >
      <button
        type="button"
        onClick={() => openCardPeek(card.id)}
        className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          {projectTitle ? (
            <span className="mb-0.5 block truncate text-caption font-medium text-primary">
              {projectTitle}
            </span>
          ) : null}
          <span
            className={cn('block truncate text-small font-medium', strikethroughClass(done))}
            title={card.title}
          >
            {card.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            {card.status === 'active' ? (
              <span className="inline-flex items-center gap-1">
                {card.workStage === 'in_progress' ? (
                  <CircleDot className="size-3 text-primary" aria-hidden="true" />
                ) : (
                  <Circle className="size-3" aria-hidden="true" />
                )}
                {t(card.workStage === 'in_progress' ? 'homeMember.inProgress' : 'homeMember.toDo')}
              </span>
            ) : null}
            <ArchivedCardBadge card={card} />
            {card.dueAt ? (
              <span
                className={cn(
                  'tabular-nums',
                  card.status === 'active' && card.risk === 'overdue' && 'text-destructive',
                )}
                title={card.risk === 'overdue' ? t('work.risk.overdue') : undefined}
              >
                {formatDate(new Date(card.dueAt), locale)}
              </span>
            ) : null}
          </span>
        </span>
        {card.checklistTotal > 0 ? (
          <ProgressRing
            value={progress}
            size={32}
            strokeWidth={3}
            label={t('homeMember.checklistProgress', {
              done: card.checklistDone,
              total: card.checklistTotal,
            })}
            className="shrink-0"
            toneClassName={progress === 100 ? 'text-success' : 'text-primary'}
          >
            <span className="text-[10px] tabular-nums">
              {card.checklistDone}/{card.checklistTotal}
            </span>
          </ProgressRing>
        ) : null}
      </button>
    </div>
  )
}

/** Active project assignments and standalone cards are disjoint; completed views retain all origins. */
export function memberCardsForCategory(
  cards: Card[],
  category: WorkCategory,
  stage: ActiveStage,
): Card[] {
  return sortMemberTasks(
    cards.filter((card) => {
      if (category === 'done' || category === 'archived') return card.status === category
      return (
        card.status === 'active' &&
        Boolean(card.projectId) === (category === 'projects') &&
        (stage === 'all' || (card.workStage ?? 'todo') === stage)
      )
    }),
  )
}

export function MemberOverview({ header }: { header: React.ReactNode }) {
  const t = useT(),
    locale = useLocale()
  const { departmentId } = useDepartment()
  const me = useMeQuery().data!
  const scope = [departmentId, me.user.id, me.actingForUserId] as const
  const qc = useQueryClient()
  const selectionKey = React.useMemo(
    () => ['home', 'selection', departmentId, me.user.id, me.actingForUserId],
    [departmentId, me.user.id, me.actingForUserId],
  )
  type Selection = {
    panel: 'inbox' | 'work'
    category: WorkCategory
    lastActiveCategory: 'individual' | 'projects'
    stage: ActiveStage
    summary: 'active' | 'completed' | null
  }
  const saved = qc.getQueryData<Selection>(selectionKey)
  const [panel, setPanel] = React.useState<'inbox' | 'work'>(saved?.panel ?? 'work')
  const [category, setCategory] = React.useState<WorkCategory>(saved?.category ?? 'individual')
  const [lastActiveCategory, setLastActiveCategory] = React.useState<'individual' | 'projects'>(
    saved?.lastActiveCategory ?? 'individual',
  )
  const [stage, setStage] = React.useState<ActiveStage>(saved?.stage ?? 'all')
  const [summary, setSummary] = React.useState<'active' | 'completed' | null>(
    saved?.summary ?? null,
  )
  // Keep the originating category on a drill-in return, scoped to the signed-in/view-as identity.
  React.useEffect(() => {
    qc.setQueryData(selectionKey, { panel, category, lastActiveCategory, stage, summary })
  }, [qc, selectionKey, panel, category, lastActiveCategory, stage, summary])
  const [viewportRef, height] = useViewportBoundedHeight<HTMLDivElement>(0, true)
  // The shared realtime bridge invalidates the work prefix for card/checklist/focus changes
  // and refreshes it on reconnect; ordinary query focus/refetch behavior covers returning visits.
  const cardsQuery = useQuery({
    queryKey: ['work', 'member-home', 'cards', ...scope],
    queryFn: ({ signal }) => fetchMemberHomeCards(signal),
  })
  const counts = useQuery({
    queryKey: ['work', 'member-home', 'counts', ...scope],
    queryFn: fetchPersonalOverview,
  })
  const members = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: !!departmentId,
  })
  const units = useQuery({
    queryKey: ['structure', 'units', departmentId],
    queryFn: () => fetchUnitsOverview(departmentId!),
    enabled: !!departmentId,
  })
  const projects = useProjectsQuery()
  const range = React.useMemo(() => {
    const from = new Date()
    return { from, to: new Date(from.getTime() + 30 * 86400000) }
  }, [])
  const events = useEventsQuery(range)
  const queries = [cardsQuery, counts, members, units, projects]
  const allCards = cardsQuery.data ?? []
  const myUnits = (units.data?.units ?? []).filter((unit) =>
    members.data?.some((member) => member.userId === me.user.id && member.unitId === unit.id),
  )
  const unitIds = new Set(myUnits.map((unit) => unit.id))
  const colleagues = [
    ...new Map(
      (members.data ?? [])
        .filter((member) => member.unitId && unitIds.has(member.unitId))
        .map((member) => [member.userId, member]),
    ).values(),
  ]
  const palette = React.useMemo(
    () => createUnitPalette(units.data?.units ?? []),
    [units.data?.units],
  )
  const myProjects = (projects.data ?? []).filter(
    (project) =>
      project.status !== 'archived' &&
      (project.ownerUserId === me.user.id ||
        project.members.includes(me.user.id) ||
        allCards.some((card) => card.projectId === project.id)),
  )
  const upcoming = [
    ...allCards
      .filter((card) => card.status === 'active' && card.dueAt && new Date(card.dueAt) <= range.to)
      .map((card) => ({
        id: card.id,
        title: card.title,
        date: card.dueAt!,
        event: false,
        href: drill(`/work/card?id=${card.id}`),
      })),
    ...(events.data?.items ?? [])
      .filter(
        (event) =>
          !['done', 'cancelled', 'draft'].includes(event.status) && event.myRsvp?.status !== 'no',
      )
      .map((event) => ({
        id: event.id,
        title: event.title,
        date: event.startsAt,
        event: true,
        href: drill(`/events?event=${event.id}`),
      })),
  ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const tasks = memberCardsForCategory(allCards, category, stage)
  const individualCount = memberCardsForCategory(allCards, 'individual', stage).length
  const projectCards = memberCardsForCategory(allCards, 'projects', stage)
  const projectCardsById = new Map(
    myProjects.map((project) => [
      project.id,
      projectCards.filter((card) => card.projectId === project.id),
    ]),
  )
  // Match the task order: nearest assignment (or project deadline), then its priority and title.
  const orderedProjects = [...myProjects].sort((a, b) => {
    const aCard = projectCardsById.get(a.id)?.[0],
      bCard = projectCardsById.get(b.id)?.[0]
    const aDate = aCard?.dueAt ?? (a.targetOn ? `${a.targetOn}T23:59:59` : null)
    const bDate = bCard?.dueAt ?? (b.targetOn ? `${b.targetOn}T23:59:59` : null)
    if (aDate !== bDate) {
      if (!aDate) return 1
      if (!bDate) return -1
      return Date.parse(aDate) - Date.parse(bDate)
    }
    const priority =
      (aCard ? PRIORITY_ORDER.indexOf(aCard.priority) : PRIORITY_ORDER.length) -
      (bCard ? PRIORITY_ORDER.indexOf(bCard.priority) : PRIORITY_ORDER.length)
    return priority || a.title.localeCompare(b.title)
  })
  const count = counts.data
  if (queries.some((query) => query.isPending))
    return <StateView kind="loading" titleKey="state.loading" />
  if (queries.some((query) => query.isError))
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            for (const query of queries) void query.refetch()
          },
        }}
      />
    )
  function showCategory(value: WorkCategory) {
    setPanel('work')
    setCategory(value)
    setSummary(null)
    if (value === 'individual' || value === 'projects') setLastActiveCategory(value)
    else setStage('all')
  }
  function showActive(value: ActiveStage) {
    setPanel('work')
    setCategory(lastActiveCategory)
    setSummary('active')
    setStage(value)
  }
  const calendar = (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-label={t('homeMember.upcoming')}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <h2 className="font-display text-h3">{t('homeMember.upcoming')}</h2>
        <RouterLink
          href={drill('/work/calendar?q=assignee%3A%40me')}
          className="flex min-h-8 items-center gap-1 text-caption font-medium text-primary"
        >
          {t('portal.overview.calendar')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </RouterLink>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {events.isError ? (
          <Button size="sm" variant="ghost" onClick={() => void events.refetch()}>
            {t('homeMember.eventsRetry')}
          </Button>
        ) : null}
        {upcoming.length ? (
          upcoming.map((item) => (
            <RouterLink
              key={`${item.event ? 'event' : 'card'}:${item.id}`}
              href={item.href}
              className="flex min-h-14 items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md',
                  item.event ? 'bg-info/10 text-info' : 'bg-primary/10 text-primary',
                )}
              >
                {item.event ? (
                  <CalendarDays className="size-4" aria-hidden="true" />
                ) : (
                  <CheckCheck className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-medium" title={item.title}>
                  {item.title}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
                  <span className={cn(item.event && 'text-info')}>
                    {t(item.event ? 'homeMember.event' : 'homeMember.deadline')}
                  </span>
                  <span
                    className={cn(
                      'tabular-nums',
                      !item.event && new Date(item.date) < range.from && 'text-destructive',
                    )}
                  >
                    {formatDate(new Date(item.date), locale)}
                  </span>
                </span>
              </span>
            </RouterLink>
          ))
        ) : (
          <p className="p-3 text-small text-muted-foreground">{t('homeMember.noUpcoming')}</p>
        )}
      </div>
    </section>
  )
  return (
    <div
      ref={viewportRef}
      data-testid="member-overview"
      data-mode="overview"
      className="flex min-h-0 flex-col gap-3 overflow-hidden"
      style={{ height: height ?? 'calc(100dvh - 120px)' }}
    >
      {header}
      <div
        className="flex shrink-0 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 lg:grid lg:grid-cols-3 lg:gap-3 lg:overflow-visible lg:pb-0"
        aria-label={t('homeMember.metrics')}
      >
        <section
          className={cn(
            HOME_METRIC_INTERACTION,
            'flex h-28 w-64 shrink-0 snap-start flex-col justify-between rounded-lg border border-primary/20 bg-primary p-3.5 text-primary-foreground lg:w-auto',
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-7 w-1 shrink-0 rounded-full',
                unitColorClass(palette, myUnits[0]?.id),
              )}
            />
            <span className="min-w-0">
              <span className="block text-caption opacity-80">{t('homeMember.myUnit')}</span>
              <RouterLink
                href={drill(myUnits[0] ? `/people?unit=${myUnits[0].id}` : '/structure')}
                className="block truncate text-small font-semibold after:absolute after:inset-0 after:rounded-lg"
                title={myUnits.map((unit) => unit.name).join(' · ')}
              >
                {myUnits.map((unit) => unit.name).join(' · ') || t('homeMember.noUnit')}
              </RouterLink>
            </span>
          </div>
          <div className="relative z-10 flex w-fit -space-x-1.5 items-center">
            {colleagues.slice(0, 5).map((member, index) => (
              <HoverCard key={member.userId}>
                <HoverCardTrigger asChild>
                  <RouterLink
                    href={drill(`/people?person=${member.userId}`)}
                    aria-label={`${member.givenName} ${member.familyName}`}
                    className="devon-avatar-stack-item flex size-9 items-center justify-center rounded-full"
                    style={{ '--avatar-stack-order': 5 - index } as React.CSSProperties}
                  >
                    <Avatar
                      alt={`${member.givenName} ${member.familyName}`}
                      decorative
                      size="sm"
                      initials={initialsFromName(member.givenName, member.familyName)}
                      src={avatarUrl(member.avatarKey, 64)}
                      className={cn(
                        'size-8 min-h-0 min-w-0 ring-2 ring-primary',
                        unitColorClass(palette, member.unitId),
                      )}
                    />
                  </RouterLink>
                </HoverCardTrigger>
                <HoverCardContent className="w-64 p-3">
                  <p className="text-small font-semibold">
                    {member.givenName} {member.familyName}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {member.title || t('overviewChat.member')}
                  </p>
                </HoverCardContent>
              </HoverCard>
            ))}
            {colleagues.length > 5 ? (
              <span className="pointer-events-none inline-flex size-8 items-center justify-center rounded-full bg-primary-foreground/20 text-caption ring-2 ring-primary">
                +{colleagues.length - 5}
              </span>
            ) : null}
            {!colleagues.length ? (
              <Users className="size-5 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </div>
        </section>
        <section
          className={cn(
            HOME_METRIC_INTERACTION,
            'flex h-28 w-64 shrink-0 snap-start flex-col justify-between rounded-lg border border-border bg-card p-3.5 hover:border-primary/50 lg:w-auto',
          )}
        >
          <button
            type="button"
            onClick={() => showActive('all')}
            className="flex cursor-pointer items-center justify-between text-left text-small font-medium after:absolute after:inset-0 after:rounded-lg"
          >
            <span>{t('homeMember.active')}</span>
            <ArrowRight className="size-4 opacity-70" aria-hidden="true" />
          </button>
          <span className="font-display text-3xl leading-none tabular-nums">
            {count?.openCount ?? 0}
          </span>
          <div className="flex items-center gap-2 text-caption">
            <button
              type="button"
              onClick={() => showActive('todo')}
              className="relative z-10 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm px-1 transition-colors hover:bg-accent hover:text-primary"
            >
              <Circle className="size-3" aria-hidden="true" />
              {t('homeMember.toDo')} <strong>{count?.toDoCount ?? 0}</strong>
            </button>
            <button
              type="button"
              onClick={() => showActive('in_progress')}
              className="relative z-10 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm px-1 transition-colors hover:bg-accent hover:text-primary"
            >
              <CircleDot className="size-3" aria-hidden="true" />
              {t('homeMember.inProgress')} <strong>{count?.inProgressCount ?? 0}</strong>
            </button>
          </div>
        </section>
        <section
          className={cn(
            HOME_METRIC_INTERACTION,
            'flex h-28 w-64 shrink-0 snap-start flex-col justify-between rounded-lg border border-border bg-card p-3.5 hover:border-primary/50 lg:w-auto',
          )}
        >
          <button
            type="button"
            onClick={() => {
              setPanel('work')
              setSummary('completed')
              setStage('all')
            }}
            className="flex cursor-pointer items-center justify-between text-left text-small font-medium after:absolute after:inset-0 after:rounded-lg"
          >
            <span>{t('homeMember.completed')}</span>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
          <span className="font-display text-3xl leading-none tabular-nums">
            {(count?.doneCount ?? 0) + (count?.archivedCount ?? 0)}
          </span>
          <div className="flex items-center gap-2 text-caption text-muted-foreground">
            <button
              type="button"
              onClick={() => showCategory('done')}
              className="relative z-10 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm px-1 transition-colors hover:bg-accent hover:text-primary"
            >
              <CheckCheck className="size-3 text-success" aria-hidden="true" />
              {t('homeMember.done')} <strong>{count?.doneCount ?? 0}</strong>
            </button>
            <button
              type="button"
              onClick={() => showCategory('archived')}
              className="relative z-10 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-sm px-1 transition-colors hover:bg-accent hover:text-primary"
            >
              <Archive className="size-3" aria-hidden="true" />
              {t('homeMember.archived')} <strong>{count?.archivedCount ?? 0}</strong>
            </button>
          </div>
        </section>
      </div>
      <HomeWorkspace panel={panel} onPanelChange={setPanel}>
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
          aria-label={t('homeRefinement.myWork')}
        >
          <div className="shrink-0 border-b border-border p-3 pb-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-h3">{t('homeRefinement.myWork')}</h2>
              <span className="text-caption text-muted-foreground">
                {t('homeRefinement.deadlineFirst')}
              </span>
            </div>
            <div
              role="group"
              aria-label={t('homeRefinement.workCategory')}
              className="hidden items-center gap-0.5 rounded-md border border-border bg-muted p-0.5 xl:flex"
            >
              {(
                [
                  ['individual', t('homeRefinement.individual'), individualCount],
                  ['projects', t('homeRefinement.projects'), projectCards.length],
                  ['done', t('homeMember.done'), count?.doneCount ?? 0],
                  ['archived', t('homeMember.archived'), count?.archivedCount ?? 0],
                ] as const
              ).map(([value, label, amount]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={!summary && category === value}
                  onClick={() => showCategory(value)}
                  className={cn(
                    'min-h-8 min-w-0 flex-1 whitespace-nowrap rounded-sm px-2 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    !summary && category === value
                      ? 'bg-card text-foreground shadow-1'
                      : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
                  )}
                >
                  {label} <span className="tabular-nums">{amount}</span>
                </button>
              ))}
            </div>
            <select
              aria-label={t('homeRefinement.workCategory')}
              value={summary ?? category}
              onChange={(event) => showCategory(event.target.value as WorkCategory)}
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden"
            >
              {summary ? (
                <option value={summary} disabled hidden>
                  {t(
                    summary === 'completed'
                      ? 'homeMember.completed'
                      : stage === 'todo'
                        ? 'homeMember.toDo'
                        : stage === 'in_progress'
                          ? 'homeMember.inProgress'
                          : 'homeRefinement.allActive',
                  )}
                </option>
              ) : null}
              <option value="individual">
                {t('homeRefinement.individual')} · {individualCount}
              </option>
              <option value="projects">
                {t('homeRefinement.projects')} · {projectCards.length}
              </option>
              <option value="done">
                {t('homeMember.done')} · {count?.doneCount ?? 0}
              </option>
              <option value="archived">
                {t('homeMember.archived')} · {count?.archivedCount ?? 0}
              </option>
            </select>
            {summary || stage !== 'all' ? (
              <button
                type="button"
                onClick={() => {
                  setStage('all')
                  setSummary(null)
                  if (summary) setCategory(lastActiveCategory)
                }}
                className="mt-2 inline-flex min-h-7 items-center gap-1 rounded-full bg-accent px-2 text-caption text-primary"
                aria-label={t('homeRefinement.clearStatus', {
                  status: t(
                    summary === 'completed'
                      ? 'homeMember.completed'
                      : stage === 'todo'
                        ? 'homeMember.toDo'
                        : stage === 'in_progress'
                          ? 'homeMember.inProgress'
                          : 'homeRefinement.allActive',
                  ),
                })}
              >
                {t(
                  summary === 'completed'
                    ? 'homeMember.completed'
                    : stage === 'todo'
                      ? 'homeMember.toDo'
                      : stage === 'in_progress'
                        ? 'homeMember.inProgress'
                        : 'homeRefinement.allActive',
                )}
                <X className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {summary ? (
              <div className="space-y-3">
                {(summary === 'completed'
                  ? (['done', 'archived'] as const)
                  : (['individual', 'projects'] as const)
                ).map((origin) => {
                  const rows = memberCardsForCategory(allCards, origin, stage)
                  return (
                    <section key={origin}>
                      <h3 className="px-2 py-1.5 text-caption font-semibold text-muted-foreground">
                        {t(
                          origin === 'individual'
                            ? 'homeRefinement.individual'
                            : origin === 'projects'
                              ? 'homeRefinement.projects'
                              : origin === 'done'
                                ? 'homeMember.done'
                                : 'homeMember.archived',
                        )}{' '}
                        <span className="tabular-nums">{rows.length}</span>
                      </h3>
                      <div className="flex flex-col gap-1.5">
                        {rows.map((card) => (
                          <MemberTask
                            key={card.id}
                            card={card}
                            projectTitle={
                              projects.data?.find((project) => project.id === card.projectId)?.title
                            }
                          />
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            ) : category === 'projects' ? (
              <div className="space-y-3">
                {orderedProjects.map((project) => (
                  <section
                    key={project.id}
                    className="rounded-md border border-border bg-accent/25 p-2"
                  >
                    <RouterLink
                      href={drill(`/projects/view?id=${project.id}`)}
                      className="flex min-h-10 items-center gap-2 rounded-sm px-1 text-primary hover:bg-accent"
                    >
                      <FolderKanban className="size-4 shrink-0" aria-hidden="true" />
                      <span
                        className="min-w-0 flex-1 truncate text-small font-semibold"
                        title={project.title}
                      >
                        {project.title}
                      </span>
                      <ProgressRing
                        value={project.progress * 100}
                        size={28}
                        strokeWidth={3}
                        label={t('homeMember.projectProgress', { title: project.title })}
                      />
                      <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                    </RouterLink>
                    <div className="mt-1 flex flex-col gap-1.5">
                      {(projectCardsById.get(project.id) ?? []).map((card) => (
                        <MemberTask key={card.id} card={card} />
                      ))}
                      {!projectCardsById.get(project.id)?.length ? (
                        <p className="px-1 py-2 text-caption text-muted-foreground">
                          {t(
                            stage === 'all'
                              ? 'homeMember.noProjectTasks'
                              : 'homeRefinement.noMatchingAssignments',
                          )}
                        </p>
                      ) : null}
                    </div>
                  </section>
                ))}
                {!orderedProjects.length ? (
                  <p className="p-3 text-small text-muted-foreground">
                    {t('homeMember.noProjects')}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {tasks.map((card) => (
                  <MemberTask
                    key={card.id}
                    card={card}
                    projectTitle={
                      projects.data?.find((project) => project.id === card.projectId)?.title
                    }
                  />
                ))}
                {!tasks.length ? (
                  <p className="p-3 text-small text-muted-foreground">{t('homeMember.noTasks')}</p>
                ) : null}
              </div>
            )}
          </div>
        </section>
        {calendar}
      </HomeWorkspace>
    </div>
  )
}

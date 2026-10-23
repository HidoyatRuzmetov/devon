import * as React from 'react'
import { motion } from 'motion/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Avatar,
  Button,
  Checkbox,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  ProgressRing,
  SegmentedControl,
  StateView,
  cn,
  initialsFromName,
  strikethroughClass,
  tweenPage,
  useReducedMotion,
} from '@devon/ui'
import {
  Archive,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  Circle,
  CircleDot,
  FolderKanban,
  HelpCircle,
  Users,
} from 'lucide-react'
import { useDepartment, useMeQuery } from '../../lib/session.js'
import { RouterLink, useSearchParams } from '../../lib/router.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { avatarUrl } from '../../lib/avatar.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import { fetchMembers, fetchUnitsOverview } from '../structure/api.js'
import { fetchPersonalOverview } from '../analytics/api.js'
import { fetchCards, type Card } from '../work/api.js'
import { usePatchCardMutation, useRestoreCardMutation } from '../work/hooks.js'
import { ArchivedCardBadge } from '../work/components/archived-card-badge.js'
import { openCardPeek } from '../work/components/card-peek-dialog.js'
import { isCardCompleted, PRIORITY_ORDER } from '../work/lib/format.js'
import { useProjectsQuery } from '../projects/hooks.js'
import { useEventsQuery } from '../events/hooks.js'
import { OverviewAssistant } from './overview-assistant.js'

const drill = (path: string) => `${path}${path.includes('?') ? '&' : '?'}from=overview`
type WorkFilter = 'active' | 'done' | 'archived'
type ActiveStage = 'all' | 'todo' | 'in_progress'
type HomePanel = 'work' | 'projects' | 'calendar'

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
    if (a.focusPinned !== b.focusPinned) return a.focusPinned ? -1 : 1
    const overdue = Number(b.risk === 'overdue') - Number(a.risk === 'overdue')
    if (overdue) return overdue
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
    locale = useLocale(),
    qc = useQueryClient()
  const patch = usePatchCardMutation(),
    restore = useRestoreCardMutation()
  const done = isCardCompleted(card)
  const archived = card.status === 'archived'
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
      <Checkbox
        checked={done}
        disabled={archived || card.canEdit === false || patch.isPending}
        aria-label={t(done ? 'homeMember.reopenTask' : 'homeMember.toggleTask', {
          title: card.title,
        })}
        size="sm"
        celebrate
        onCheckedChange={(value) =>
          patch.mutate(
            { id: card.id, patch: { status: value === true ? 'done' : 'active' } },
            {
              onSettled: () => {
                void qc.invalidateQueries({ queryKey: ['work', 'member-home'] })
              },
            },
          )
        }
      />
      <button
        type="button"
        onClick={() => openCardPeek(card.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
      {archived && card.canEdit !== false ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(card.id, {
              onSettled: () => {
                void qc.invalidateQueries({ queryKey: ['work', 'member-home'] })
              },
            })
          }
        >
          {t('work.card.restore')}
        </Button>
      ) : null}
    </div>
  )
}

export function MemberOverview({
  header,
  allowConversationRoute,
}: {
  header: React.ReactNode
  allowConversationRoute: boolean
}) {
  const t = useT(),
    locale = useLocale(),
    reduced = useReducedMotion(),
    desktop = useMediaQuery('(min-width: 1024px)')
  const { departmentId } = useDepartment()
  const me = useMeQuery().data!
  const search = useSearchParams()
  const [expanded, setExpanded] = React.useState(
    allowConversationRoute && Boolean(search.get('conversation')),
  )
  const [panel, setPanel] = React.useState<HomePanel>('work')
  const [filter, setFilter] = React.useState<WorkFilter>('active')
  const [stage, setStage] = React.useState<ActiveStage>('all')
  const [selectedProject, setSelectedProject] = React.useState<string | null>(null)
  const [viewportRef, height] = useViewportBoundedHeight<HTMLDivElement>(0, true)
  const scope = [departmentId, me.user.id, me.actingForUserId] as const
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
  const tasks = sortMemberTasks(
    allCards.filter(
      (card) =>
        card.status === filter &&
        (filter !== 'active' || stage === 'all' || (card.workStage ?? 'todo') === stage),
    ),
  )
  const visibleProject =
    myProjects.find((project) => project.id === selectedProject) ?? myProjects[0]
  const projectTasks = visibleProject
    ? sortMemberTasks(
        allCards.filter((card) => card.projectId === visibleProject.id && card.status === 'active'),
      )
    : []
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
  function showWork(value: WorkFilter, active: ActiveStage = 'all') {
    setPanel('work')
    setFilter(value)
    setStage(active)
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
      data-mode={expanded ? 'conversation' : 'overview'}
      className="flex min-h-0 flex-col gap-0 overflow-hidden"
      style={{ height: height ?? 'calc(100dvh - 120px)' }}
    >
      <motion.div
        data-testid="overview-dashboard"
        inert={expanded}
        aria-hidden={expanded}
        initial={false}
        animate={{
          height: expanded ? 0 : Math.max(260, (height ?? 760) - (desktop ? 240 : 180)),
          opacity: expanded ? 0 : 1,
          y: expanded && !reduced ? -12 : 0,
        }}
        transition={reduced ? { duration: 0 } : tweenPage}
        className="grid min-h-0 shrink-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden pb-3"
      >
        <div className="flex items-start justify-between gap-3">
          {header}
          <RouterLink
            href={drill('/help')}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-small text-muted-foreground hover:bg-accent hover:text-primary"
          >
            <HelpCircle className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('help.title')}</span>
            <span className="sr-only sm:hidden">{t('help.title')}</span>
          </RouterLink>
        </div>
        <div
          className="grid grid-cols-2 gap-2 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-3"
          aria-label={t('homeMember.metrics')}
        >
          <section className="relative col-span-2 flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-lg border border-border bg-card px-3 py-2 lg:col-span-1 lg:flex-col lg:items-stretch lg:gap-1.5 lg:py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'h-7 w-1 shrink-0 rounded-full',
                  unitColorClass(palette, myUnits[0]?.id),
                )}
              />
              <span className="min-w-0">
                <span className="block text-caption text-muted-foreground">
                  {t('homeMember.myUnit')}
                </span>
                <RouterLink
                  href={drill(myUnits[0] ? `/people?unit=${myUnits[0].id}` : '/structure')}
                  className="block truncate text-small font-semibold"
                  title={myUnits.map((unit) => unit.name).join(' · ')}
                >
                  {myUnits.map((unit) => unit.name).join(' · ') || t('homeMember.noUnit')}
                </RouterLink>
              </span>
            </div>
            <div className="flex shrink-0 -space-x-1.5 items-center lg:pl-3">
              {colleagues.slice(0, 5).map((member, index) => (
                <HoverCard key={member.userId}>
                  <HoverCardTrigger asChild>
                    <RouterLink
                      href={drill(`/people?person=${member.userId}`)}
                      aria-label={`${member.givenName} ${member.familyName}`}
                      className="devon-avatar-stack-item flex size-8 shrink-0 items-center justify-center rounded-full"
                      style={{ '--avatar-stack-order': 5 - index } as React.CSSProperties}
                    >
                      <Avatar
                        alt={`${member.givenName} ${member.familyName}`}
                        decorative
                        initials={initialsFromName(member.givenName, member.familyName)}
                        src={avatarUrl(member.avatarKey, 64)}
                        className={cn(
                          'size-7 min-h-0 min-w-0 ring-2 ring-card',
                          unitColorClass(palette, member.unitId),
                        )}
                      />
                    </RouterLink>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-60 p-3">
                    <p className="text-small font-semibold">
                      {member.givenName} {member.familyName}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {member.title || t('overviewChat.member')}
                    </p>
                  </HoverCardContent>
                </HoverCard>
              ))}
              {colleagues.length > 5 ? (
                <span className="relative inline-flex size-7 items-center justify-center rounded-full bg-muted text-caption ring-2 ring-card">
                  +{colleagues.length - 5}
                </span>
              ) : null}
              {!colleagues.length ? (
                <Users className="size-5 text-muted-foreground" aria-hidden="true" />
              ) : null}
            </div>
          </section>
          <section className="rounded-lg border border-primary/20 bg-primary px-3 py-2 text-primary-foreground lg:py-3">
            <button
              type="button"
              onClick={() => showWork('active')}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-caption font-medium lg:text-small">
                {t('homeMember.active')}
              </span>
              <span className="font-display text-h2 tabular-nums">{count?.openCount ?? 0}</span>
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-caption">
              <button
                type="button"
                onClick={() => showWork('active', 'todo')}
                className="inline-flex min-h-7 items-center gap-1 hover:underline"
              >
                <Circle className="size-3" aria-hidden="true" />
                {t('homeMember.toDo')}{' '}
                <strong className="tabular-nums">{count?.toDoCount ?? 0}</strong>
              </button>
              <button
                type="button"
                onClick={() => showWork('active', 'in_progress')}
                className="inline-flex min-h-7 items-center gap-1 hover:underline"
              >
                <CircleDot className="size-3" aria-hidden="true" />
                {t('homeMember.inProgress')}{' '}
                <strong className="tabular-nums">{count?.inProgressCount ?? 0}</strong>
              </button>
            </div>
          </section>
          <section className="rounded-lg border border-border bg-card px-3 py-2 lg:py-3">
            <button
              type="button"
              onClick={() => showWork('done')}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-caption font-medium lg:text-small">
                {t('homeMember.completed')}
              </span>
              <span className="font-display text-h2 tabular-nums">
                {(count?.doneCount ?? 0) + (count?.archivedCount ?? 0)}
              </span>
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-caption text-muted-foreground">
              <button
                type="button"
                onClick={() => showWork('done')}
                className="inline-flex min-h-7 items-center gap-1 hover:text-foreground hover:underline"
              >
                <CheckCheck className="size-3 text-success" aria-hidden="true" />
                {t('homeMember.done')}{' '}
                <strong className="tabular-nums">{count?.doneCount ?? 0}</strong>
              </button>
              <button
                type="button"
                onClick={() => showWork('archived')}
                className="inline-flex min-h-7 items-center gap-1 hover:text-foreground hover:underline"
              >
                <Archive className="size-3" aria-hidden="true" />
                {t('homeMember.archived')}{' '}
                <strong className="tabular-nums">{count?.archivedCount ?? 0}</strong>
              </button>
            </div>
          </section>
        </div>
        <div className="flex min-h-0 flex-col gap-2 lg:grid lg:grid-cols-[1.3fr_1fr] lg:gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <SegmentedControl
              value={panel}
              onValueChange={setPanel}
              label={t('homeMember.panels')}
              options={[
                { value: 'work', label: t('homeMember.myTasks') },
                { value: 'projects', label: t('homeMember.myProjects') },
                ...(!desktop
                  ? [{ value: 'calendar' as const, label: t('homeMember.upcoming') }]
                  : []),
              ]}
              className="shrink-0 self-start"
            />
            {panel === 'calendar' && !desktop ? (
              calendar
            ) : panel === 'projects' ? (
              <section
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
                aria-label={t('homeMember.myProjects')}
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <span className="text-caption text-muted-foreground">
                    {t('homeMember.projectsCount', { count: myProjects.length })}
                  </span>
                  <RouterLink
                    href={drill('/projects')}
                    className="inline-flex min-h-8 items-center gap-1 text-caption font-medium text-primary"
                  >
                    {t('homeMember.allProjects')}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </RouterLink>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                  {myProjects.length ? (
                    myProjects.map((project) => (
                      <div key={project.id} className="mb-2 last:mb-0">
                        <button
                          type="button"
                          aria-expanded={project.id === visibleProject?.id}
                          onClick={() => setSelectedProject(project.id)}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left',
                            project.id === visibleProject?.id ? 'bg-accent' : 'hover:bg-muted/50',
                          )}
                        >
                          <FolderKanban
                            className="size-4 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-small font-medium">
                            {project.title}
                          </span>
                          <ProgressRing
                            value={project.progress * 100}
                            size={28}
                            strokeWidth={3}
                            label={t('homeMember.projectProgress', { title: project.title })}
                          />
                        </button>
                        {project.id === visibleProject?.id ? (
                          <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-primary/20 pl-2">
                            {projectTasks.map((card) => (
                              <MemberTask key={card.id} card={card} />
                            ))}
                            {!projectTasks.length ? (
                              <p className="px-2 py-1 text-caption text-muted-foreground">
                                {t('homeMember.noProjectTasks')}
                              </p>
                            ) : null}
                            <RouterLink
                              href={drill(`/projects/view?id=${project.id}`)}
                              className="inline-flex min-h-9 items-center gap-1 px-2 text-caption font-medium text-primary"
                            >
                              {t('homeMember.openProject')}
                              <ArrowRight className="size-3.5" aria-hidden="true" />
                            </RouterLink>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="p-3 text-small text-muted-foreground">
                      {t('homeMember.noProjects')}
                    </p>
                  )}
                </div>
              </section>
            ) : (
              <section
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
                aria-label={t('homeMember.myTasks')}
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border px-2 py-1.5">
                  <SegmentedControl
                    value={filter}
                    onValueChange={(value) => {
                      setFilter(value)
                      setStage('all')
                    }}
                    label={t('homeMember.taskStatus')}
                    options={[
                      { value: 'active', label: t('homeMember.active') },
                      { value: 'done', label: t('homeMember.done') },
                      { value: 'archived', label: t('homeMember.archived') },
                    ]}
                  />
                  {filter === 'active' && stage !== 'all' ? (
                    <button
                      type="button"
                      onClick={() => setStage('all')}
                      className="min-h-8 px-2 text-caption text-primary"
                    >
                      {t(stage === 'todo' ? 'homeMember.toDo' : 'homeMember.inProgress')} ·{' '}
                      {t('homeMember.showAll')}
                    </button>
                  ) : (
                    <span className="px-2 text-caption tabular-nums text-muted-foreground">
                      {tasks.length}
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
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
                      <p className="p-3 text-small text-muted-foreground">
                        {t(filter === 'active' ? 'homeMember.noTasks' : 'homeMember.noCompleted')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            )}
          </div>
          <div className="hidden min-h-0 lg:flex">{calendar}</div>
        </div>
      </motion.div>
      <OverviewAssistant
        audience="member"
        expanded={expanded}
        onExpandedChange={setExpanded}
        allowConversationRoute={allowConversationRoute}
        cardTitle={(id) => allCards.find((card) => card.id === id)?.title ?? null}
      />
    </div>
  )
}

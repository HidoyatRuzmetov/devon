import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatDate } from '@devon/i18n'
import {
  Progress,
  StateView,
  Avatar,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  initialsFromName,
  cn,
} from '@devon/ui'
import { ArrowRight, CalendarDays, Users, FolderKanban, CheckSquare } from 'lucide-react'
import { useDepartment } from '../../lib/session.js'
import { RouterLink } from '../../lib/router.js'
import { useViewportBoundedHeight } from '../../lib/use-viewport-bounded-height.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { fetchMembers, fetchUnitsOverview } from '../structure/api.js'
import { useBoardQuery } from '../work/hooks.js'
import { useProjectsQuery } from '../projects/hooks.js'
import { useEventsQuery } from '../events/hooks.js'
import { HomeWorkspace, HOME_METRIC_INTERACTION } from './home-workspace.js'
import { avatarUrl } from '../../lib/avatar.js'
import { createUnitPalette, unitColorClass } from '../../lib/unit-palette.js'
import type { Member } from '../structure/api.js'

const drill = (path: string) => `${path}${path.includes('?') ? '&' : '?'}from=overview`
const calendarMonth = (date: string) => {
  const value = new Date(date)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}
/** Panel-local scrolling keeps the whole Home viewport stable while every unit remains reachable. */
function OverviewPanel({
  title,
  href,
  linkLabel,
  rows,
  className,
}: {
  title: string
  href: string
  linkLabel: string
  rows: React.ReactNode[]
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-2 lg:p-3',
        className,
      )}
    >
      <h2 className="mb-2 shrink-0 font-display text-h3">{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{rows}</div>
      <RouterLink
        href={href}
        className="mt-2 flex shrink-0 items-center gap-2 text-caption font-medium text-primary"
      >
        {linkLabel}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </RouterLink>
    </section>
  )
}

export function DepartmentOverview({ header }: { header: React.ReactNode }) {
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [viewportRef, height] = useViewportBoundedHeight<HTMLDivElement>(0, true)
  const [panel, setPanel] = React.useState<'inbox' | 'work'>('work')
  const t = useT(),
    locale = useLocale(),
    { departmentId } = useDepartment()
  const membersQuery = useQuery({
    queryKey: ['structure', 'members', departmentId],
    queryFn: () => fetchMembers(departmentId!),
    enabled: !!departmentId,
  })
  const unitsQuery = useQuery({
    queryKey: ['structure', 'units', departmentId],
    queryFn: () => fetchUnitsOverview(departmentId!),
    enabled: !!departmentId,
  })
  const palette = React.useMemo(
    () => createUnitPalette(unitsQuery.data?.units ?? []),
    [unitsQuery.data?.units],
  )
  const board = useBoardQuery(),
    projectsQuery = useProjectsQuery()
  const range = React.useMemo(() => {
    const from = new Date()
    return { from, to: new Date(from.getTime() + 30 * 86400000) }
  }, [])
  const events = useEventsQuery(range)
  const queries = [membersQuery, unitsQuery, board, projectsQuery]
  if (queries.some((q) => q.isPending)) return <StateView kind="loading" titleKey="state.loading" />
  if (queries.some((q) => q.isError))
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        action={{
          labelKey: 'state.error.action',
          onAction: () => {
            for (const q of queries) void q.refetch()
          },
        }}
      />
    )
  const members = [...new Map((membersQuery.data ?? []).map((m) => [m.userId, m])).values()],
    units = unitsQuery.data?.units ?? []
  const cards = [
    ...(board.data?.columns ?? []).flatMap((c) => c.cards),
    ...(board.data?.unassigned ?? []),
  ].filter((c) => c.status === 'active')
  const projects = (projectsQuery.data ?? []).filter(
    (p) => p.status !== 'done' && p.status !== 'archived',
  )
  const now = Date.now(),
    soon = now + 7 * 86400000
  const projectLate = (p: (typeof projects)[number]) =>
    Boolean(
      (p.targetOn && new Date(`${p.targetOn}T23:59:59`).getTime() < now) ||
      p.milestones.some(
        (m) => !m.doneAt && m.dueOn && new Date(`${m.dueOn}T23:59:59`).getTime() < now,
      ),
    )
  const expected = units.reduce((sum, u) => sum + (u.expectedPeople ?? 0), 0)
  const configured =
    units.length > 0 &&
    units.every((u) => u.expectedPeople !== null && u.expectedPeople !== undefined)
  const staffing = units.map((u) => ({
    unit: u,
    people: members.filter((m) => m.unitId === u.id),
  }))
  const filled =
    configured && staffing.every(({ unit, people }) => people.length >= (unit.expectedPeople ?? 0))
  const deadlines = [
    ...cards
      .filter((c) => c.dueAt)
      .map((c) => ({ id: c.id, title: c.title, date: c.dueAt!, event: false })),
    ...projects
      .filter((p) => p.targetOn)
      .map((p) => ({
        id: p.id,
        title: p.title,
        date: p.targetOn! + 'T12:00:00',
        event: false,
      })),
    ...projects.flatMap((p) =>
      p.milestones
        .filter((m) => !m.doneAt && m.dueOn)
        .map((m) => ({
          id: m.id,
          title: `${p.title} · ${m.title}`,
          date: `${m.dueOn}T12:00:00`,
          event: false,
        })),
    ),
    ...(events.data?.items ?? [])
      .filter((e) => !['cancelled', 'done', 'draft'].includes(e.status))
      .map((e) => ({
        id: e.id,
        title: e.title,
        date: e.startsAt,
        event: true,
      })),
  ]
    .filter((d) => new Date(d.date) >= range.from && new Date(d.date) <= range.to)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const projectPercent = projects.length
    ? Math.round((100 * projects.filter((p) => !projectLate(p)).length) / projects.length)
    : 0
  const projectDue = projects.filter((p) =>
    [p.targetOn, ...p.milestones.filter((m) => !m.doneAt).map((m) => m.dueOn)].some(
      (date) => date && new Date(`${date}T23:59:59`).getTime() <= soon,
    ),
  ).length
  const taskPercent = cards.length
    ? Math.round((100 * cards.filter((c) => c.risk !== 'overdue').length) / cards.length)
    : 0
  const taskDue = cards.filter((c) => c.dueAt && new Date(c.dueAt).getTime() <= soon).length
  const workforceDetail = filled
    ? t('portal.overview.filled')
    : configured
      ? t('portal.overview.positions', { count: expected })
      : t('portal.overview.setTargets')
  const metrics = [
    {
      key: 'workforce',
      value: members.length,
      href: '/people',
      icon: Users,
      detail: workforceDetail,
    },
    {
      key: 'units',
      value: units.length,
      href: '/structure',
      icon: Users,
      detail: t('portal.overview.unitsHint'),
    },
    {
      key: 'projects',
      value: projects.length,
      href: '/projects',
      icon: FolderKanban,
      percent: projectPercent,
      dueCount: projectDue,
      detail: t('portal.overview.track', { percent: projectPercent, count: projectDue }),
    },
    {
      key: 'tasks',
      value: cards.length,
      href: '/work',
      icon: CheckSquare,
      percent: taskPercent,
      dueCount: taskDue,
      detail: t('portal.overview.track', { percent: taskPercent, count: taskDue }),
    },
  ]
  const displayedMetrics = desktop ? metrics : [metrics[0]!, metrics[2]!, metrics[3]!, metrics[1]!]
  return (
    <div
      ref={viewportRef}
      data-testid="head-overview"
      data-mode="overview"
      style={{ height: height ?? 'calc(100dvh - 120px)' }}
      className="flex min-h-0 flex-col gap-3 overflow-hidden"
    >
      {header}
      <div
        aria-label={t('overviewChat.metrics')}
        className="flex shrink-0 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-visible lg:pb-0"
      >
        {displayedMetrics.map((m) => (
          <div
            key={m.key}
            className={cn(
              'relative flex h-28 shrink-0 snap-start flex-col justify-center gap-1 rounded-lg border border-border p-2.5 lg:min-w-0 lg:p-3.5',
              HOME_METRIC_INTERACTION,
              m.key === 'workforce'
                ? 'w-64 bg-primary text-primary-foreground lg:w-auto'
                : 'w-52 bg-card lg:w-auto',
            )}
          >
            <RouterLink
              href={drill(m.href)}
              className="flex items-center justify-between gap-2 text-caption font-medium lg:text-small after:absolute after:inset-0 after:rounded-lg"
              aria-label={t(`portal.overview.${m.key}`)}
              aria-description={m.key === 'workforce' ? workforceDetail : m.detail}
            >
              <span className="truncate">{t(`portal.overview.${m.key}`)}</span>
              <m.icon className="hidden size-4 shrink-0 lg:block" aria-hidden="true" />
              {m.key === 'workforce' ? (
                <span
                  className="text-caption font-normal opacity-80 lg:hidden"
                  title={workforceDetail}
                >
                  {filled
                    ? t('overviewChat.filledShort')
                    : configured
                      ? t('overviewChat.planned', { count: expected })
                      : ''}
                </span>
              ) : null}
            </RouterLink>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="font-display text-3xl leading-none tabular-nums">{m.value}</span>
              {m.key === 'workforce' ? (
                <WorkforceAvatars members={members} palette={palette} desktop={desktop} />
              ) : null}
            </div>
            {m.key === 'workforce' ? (
              <span className="hidden text-caption opacity-80 lg:block" title={workforceDetail}>
                {filled
                  ? t('overviewChat.filledShort')
                  : configured
                    ? t('overviewChat.planned', { count: expected })
                    : t('overviewChat.planStaffing')}
              </span>
            ) : m.percent !== undefined && m.value > 0 ? (
              <div title={m.detail} className="flex min-w-0 items-center gap-2 text-caption">
                <span className="truncate text-muted-foreground">
                  {t('overviewChat.onTrack', { percent: m.percent })}
                </span>
                {m.dueCount ? (
                  <span className="shrink-0 rounded-sm bg-warning/10 px-1 text-warning-text">
                    {t('overviewChat.due', { count: m.dueCount })}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <HomeWorkspace panel={panel} onPanelChange={setPanel}>
        <OverviewPanel
          title={t('portal.overview.staffing')}
          href={drill('/structure')}
          linkLabel={t('portal.overview.units')}
          rows={staffing.map(({ unit, people }) => (
            <RouterLink
              key={unit.id}
              href={drill(`/people?unit=${unit.id}`)}
              className="flex min-h-11 items-center gap-3 rounded-sm border-t border-border px-1 py-1 transition-colors hover:bg-accent"
            >
              <span
                className={cn('h-7 w-1 shrink-0 rounded-full', unitColorClass(palette, unit.id))}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium" title={unit.name}>
                  {unit.name}
                </p>
                {unit.expectedPeople ? (
                  <Progress
                    value={Math.min(100, (people.length / unit.expectedPeople) * 100)}
                    label={unit.name}
                    className="mt-1.5 h-1"
                  />
                ) : null}
              </div>
              <span
                className="shrink-0 text-caption tabular-nums"
                title={t('portal.overview.staffed', {
                  actual: people.length,
                  expected: unit.expectedPeople ?? '—',
                })}
              >
                <span className="sr-only">
                  {t('portal.overview.staffed', {
                    actual: people.length,
                    expected: unit.expectedPeople ?? '—',
                  })}
                </span>
                <span aria-hidden="true">
                  <strong className="text-small font-semibold">{people.length}</strong> /{' '}
                  {unit.expectedPeople ?? '—'}
                </span>
              </span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </RouterLink>
          ))}
        />
        <OverviewPanel
          title={t('portal.overview.deadlines')}
          href={drill('/work/calendar')}
          linkLabel={t('portal.overview.calendar')}
          rows={[
            ...(events.isError
              ? [
                  <p
                    key="error"
                    className="flex h-11 items-center lg:h-10 text-small text-destructive"
                  >
                    {t('state.error.title')}
                  </p>,
                ]
              : []),
            ...deadlines.map((d) => (
              <RouterLink
                key={d.id}
                href={drill(`/work/calendar?month=${calendarMonth(d.date)}`)}
                className="flex min-h-11 items-center gap-3 rounded-sm border-t border-border px-1 py-1 transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    'shrink-0 rounded-md px-2 py-1.5 text-caption tabular-nums',
                    d.event ? 'bg-info/10 text-info' : 'bg-accent',
                  )}
                >
                  {formatDate(new Date(d.date), locale)}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 text-small" title={d.title}>
                  {d.title}
                </span>
                {d.event ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-info/10 px-1.5 py-0.5 text-caption text-info">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {t('homeMember.event')}
                  </span>
                ) : (
                  <CheckSquare className="size-4 shrink-0 text-primary" aria-hidden="true" />
                )}
              </RouterLink>
            )),
            ...(!deadlines.length
              ? [
                  <p
                    key="empty"
                    className="flex h-11 items-center lg:h-10 text-small text-muted-foreground"
                  >
                    {t('portal.overview.noDeadlines')}
                  </p>,
                ]
              : []),
          ]}
        />
      </HomeWorkspace>
    </div>
  )
}

function WorkforceAvatars({
  members,
  palette,
  desktop,
}: {
  members: Member[]
  palette: ReadonlyMap<string, string>
  desktop: boolean
}) {
  const t = useT()
  const wide = useMediaQuery('(min-width: 1280px)')
  const visible = members.slice(0, desktop && wide ? 4 : 2)
  return (
    <div
      data-testid="overview-workforce-avatars"
      className="relative z-10 flex -space-x-2 items-center lg:-space-x-1"
    >
      {visible.map((member, index) => {
        const name = `${member.givenName} ${member.familyName}`
        return (
          <HoverCard key={member.userId}>
            <HoverCardTrigger asChild>
              <RouterLink
                href={drill(`/people?person=${member.userId}`)}
                aria-label={name}
                className="devon-avatar-stack-item flex size-11 items-center justify-center rounded-full lg:size-7"
                style={{ '--avatar-stack-order': visible.length - index } as React.CSSProperties}
              >
                <Avatar
                  size="sm"
                  alt={name}
                  decorative
                  initials={initialsFromName(member.givenName, member.familyName)}
                  src={avatarUrl(member.avatarKey, 64)}
                  className={cn(
                    'size-10 min-h-0 min-w-0 ring-2 ring-primary lg:size-7',
                    unitColorClass(palette, member.unitId, member.membershipRole === 'head'),
                  )}
                />
              </RouterLink>
            </HoverCardTrigger>
            <HoverCardContent className="w-64 p-3">
              <div className="flex items-center gap-3">
                <Avatar
                  alt={name}
                  decorative
                  initials={initialsFromName(member.givenName, member.familyName)}
                  src={avatarUrl(member.avatarKey, 128)}
                  className={unitColorClass(
                    palette,
                    member.unitId,
                    member.membershipRole === 'head',
                  )}
                />
                <div className="min-w-0">
                  <p className="text-small font-semibold [overflow-wrap:anywhere]">{name}</p>
                  <p className="text-caption text-muted-foreground">
                    {member.title ||
                      t(
                        member.membershipRole === 'head'
                          ? 'overviewChat.head'
                          : 'overviewChat.member',
                      )}
                  </p>
                </div>
              </div>
              {member.professionalProfile?.headline ? (
                <p className="mt-2 line-clamp-2 text-small text-muted-foreground">
                  {member.professionalProfile.headline}
                </p>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        )
      })}
      {members.length > visible.length ? (
        <RouterLink
          href={drill('/people')}
          aria-label={t('overviewChat.allPeople', { count: members.length })}
          className="devon-avatar-stack-item group inline-flex size-11 items-center justify-center rounded-full text-caption lg:size-7"
          style={{ '--avatar-stack-order': 0 } as React.CSSProperties}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-primary-foreground/20 ring-2 ring-primary group-hover:bg-primary-foreground/30 lg:size-7">
            +{members.length - visible.length}
          </span>
        </RouterLink>
      ) : null}
    </div>
  )
}

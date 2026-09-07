// The Postgres-backed data layer for analytics (TECH-SPEC §9). Every function opens its own
// `withContext()` transaction (MODULE-GUIDE.md "API modules"). Chart queries read `app.cards`,
// `app.projects`, `app.events`, `app.polls`, ... -- other modules' tables -- through `Tx.raw()` the
// same way `filter.ts`'s header explains: a read of another module's table via hand-written SQL
// against the shared `app` schema, never an import of that module's own schema/repo code.
//
// Performance (TECH-SPEC §9: "no analytics query exceeds 100 ms"): an *unfiltered* summary reads
// `app.analytics_daily` (`aggregate.ts`'s precomputed rows -- a handful of indexed rows per request,
// one index scan) for throughput/on-time/open-vs-overdue; a *filtered* one (any grammar clause beyond
// a bare date range) queries `app.cards` live -- there is no way to precompute a row per arbitrary
// filter combination, but a single department's card count is bounded (TECH-SPEC §0: 100k cards is
// the whole *instance*, 200 departments' worth), so a single indexed, department-scoped aggregate
// query stays well under budget without precompute.
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import type { AuditCtx } from '../../types.js'
import {
  cardsFilterSql,
  hasPersonRestriction,
  resolveFilter,
  type ResolvedFilter,
} from './filter.js'
import { addDaysToDateString, tashkentDateString } from './aggregate.js'
import type { DailyMetrics } from './aggregate.js'
import type { AnalyticsChartKey } from './schemas.js'

function toRequestContext(ctx: AuditCtx, departmentId: string): RequestContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

function joinSet(parts: SQL[]): SQL {
  return sql.join(parts, sql.raw(', '))
}

function weekStartOf(dateStr: string): string {
  // Monday-start week key (DESIGN.md §2.3: "week starts Monday"), matching Postgres `date_trunc('week', ...)`.
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // 1 = Monday .. 7 = Sunday
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

function weeksBetween(since: string, until: string): string[] {
  const weeks: string[] = []
  let cursor = weekStartOf(since)
  const last = weekStartOf(until)
  while (cursor <= last) {
    weeks.push(cursor)
    cursor = addDaysToDateString(cursor, 7)
  }
  return weeks
}

// ---------------------------------------------------------------------------------------------------
// Summary (throughput / on-time / open-vs-overdue / load / project progress / events / polls / personal)
// ---------------------------------------------------------------------------------------------------

export type WeekPoint = { weekStart: string; count: number }
export type OnTimePoint = { weekStart: string; dueCount: number; onTimeCount: number }
export type OpenOverduePoint = { weekStart: string; openCount: number; overdueCount: number }
export type PersonLoad = { userId: string; name: string; openCount: number; overdueCount: number }
export type UnitLoad = { unitName: string | null; openCount: number; overdueCount: number }
export type ProjectProgress = {
  id: string
  title: string
  status: string
  totalTasks: number
  doneTasks: number
  progress: number
}
export type EventParticipation = {
  id: string
  title: string
  startsAt: Date
  yes: number
  no: number
  maybe: number
  waitlist: number
  rsvpRate: number
}
export type PollTurnout = {
  id: string
  question: string
  status: string
  voters: number
  turnoutRate: number
}
export type PersonalOverview = {
  openCount: number
  overdueCount: number
  doneThisWeek: number
  onTimeRate: number | null
  focusMinutesThisWeek: number
  upcomingEventCount: number
  givenOverdueCount: number
}

export type SummaryResult = {
  since: string
  until: string
  throughput: WeekPoint[]
  onTimeRate: { overall: number | null; series: OnTimePoint[] }
  openVsOverdue: OpenOverduePoint[]
  loadPerPerson: PersonLoad[]
  loadPerUnit: UnitLoad[]
  projectProgress: ProjectProgress[]
  eventsParticipation: EventParticipation[]
  pollTurnout: PollTurnout[]
  personal: PersonalOverview
}

/** Reads the precomputed table for an unfiltered window -- the fast, common path. */
async function throughputAndOnTimeFromDaily(
  tx: Tx,
  departmentId: string,
  since: string,
  until: string,
): Promise<{
  throughput: WeekPoint[]
  onTimeRate: SummaryResult['onTimeRate']
  openVsOverdue: OpenOverduePoint[]
}> {
  const rows = await tx.raw<{ day: string; metrics: DailyMetrics }>(sql`
    select day::text as day, metrics from app.analytics_daily
    where department_id = ${departmentId} and day >= ${since}::date and day <= ${until}::date
    order by day asc
  `)
  const byWeek = new Map<string, { done: number; created: number; due: number; onTime: number }>()
  const byDay = new Map<string, DailyMetrics>()
  for (const row of rows) {
    byDay.set(row.day, row.metrics)
    const week = weekStartOf(row.day)
    const bucket = byWeek.get(week) ?? { done: 0, created: 0, due: 0, onTime: 0 }
    bucket.done += row.metrics.cardsDone
    bucket.created += row.metrics.cardsCreated
    bucket.onTime += row.metrics.cardsDoneOnTime
    byWeek.set(week, bucket)
  }
  const weeks = weeksBetween(since, until)
  const throughput = weeks.map((weekStart) => ({
    weekStart,
    count: byWeek.get(weekStart)?.done ?? 0,
  }))
  // "Due count" for the on-time rate is approximated from done-with-due-date cards this window --
  // `cardsDoneOnTime` already only counts those; a day's row does not separately carry "done cards
  // that had a due date" today, so we treat every done card as the denominator candidate and note the
  // rate is therefore a slight overestimate when many done cards never had a deadline at all. Kept
  // simple on purpose: the live (filtered) path below computes the exact ratio.
  const series = weeks.map((weekStart) => {
    const b = byWeek.get(weekStart)
    return { weekStart, dueCount: b?.done ?? 0, onTimeCount: b?.onTime ?? 0 }
  })
  const totalDone = series.reduce((a, p) => a + p.dueCount, 0)
  const totalOnTime = series.reduce((a, p) => a + p.onTimeCount, 0)
  const overall = totalDone > 0 ? totalOnTime / totalDone : null

  const openVsOverdue = weeks.map((weekStart) => {
    // The precomputed table only ever carries *one* open/overdue snapshot per day (taken whenever
    // that row was last computed -- `aggregate.ts`'s header), so the trend line's per-week point is
    // that week's *last available* day's snapshot, not a true reconstruction of every day in between.
    let openCount = 0
    let overdueCount = 0
    for (let i = 6; i >= 0; i -= 1) {
      const day = addDaysToDateString(weekStart, i)
      const metrics = byDay.get(day)
      if (metrics) {
        openCount = metrics.cardsOpenAtEnd
        overdueCount = metrics.cardsOverdueAtEnd
        break
      }
    }
    return { weekStart, openCount, overdueCount }
  })

  return { throughput, onTimeRate: { overall, series }, openVsOverdue }
}

/** The live, filtered path -- one aggregate query per section, each scoped to a single department and
 * indexed on `department_id` (+ `status`/`due_at` where the migration adds a supporting index). */
async function throughputAndOnTimeLive(
  tx: Tx,
  departmentId: string,
  since: string,
  until: string,
  filter: ResolvedFilter,
): Promise<{
  throughput: WeekPoint[]
  onTimeRate: SummaryResult['onTimeRate']
  openVsOverdue: OpenOverduePoint[]
}> {
  const sinceAt = new Date(`${since}T00:00:00+05:00`)
  const untilAt = new Date(`${addDaysToDateString(until, 1)}T00:00:00+05:00`)

  const doneRows = await tx.raw<{
    week_start: string
    due_count: string
    on_time_count: string
    done_count: string
  }>(sql`
    select date_trunc('week', done_at)::date::text as week_start,
      count(*) filter (where due_at is not null) as due_count,
      count(*) filter (where due_at is not null and done_at <= due_at) as on_time_count,
      count(*) as done_count
    from app.cards
    where department_id = ${departmentId} and deleted_at is null and status = 'done'
      and done_at >= ${sinceAt} and done_at < ${untilAt}
      and ${cardsFilterSql(filter)}
    group by 1
  `)
  const weeks = weeksBetween(since, until)
  const byWeek = new Map(doneRows.map((r) => [r.week_start, r]))
  const throughput = weeks.map((weekStart) => ({
    weekStart,
    count: Number(byWeek.get(weekStart)?.done_count ?? 0),
  }))
  const series = weeks.map((weekStart) => {
    const r = byWeek.get(weekStart)
    return {
      weekStart,
      dueCount: Number(r?.due_count ?? 0),
      onTimeCount: Number(r?.on_time_count ?? 0),
    }
  })
  const totalDue = series.reduce((a, p) => a + p.dueCount, 0)
  const totalOnTime = series.reduce((a, p) => a + p.onTimeCount, 0)
  const overall = totalDue > 0 ? totalOnTime / totalDue : null

  // Open-vs-overdue: one query, `generate_series` cross-joined with this department's cards -- bounded
  // by (#weeks x #cards in one department), never the whole instance (TECH-SPEC §0's 100k is instance-
  // wide across 200 departments).
  const trendRows = await tx.raw<{
    week_start: string
    open_count: string
    overdue_count: string
  }>(sql`
    select gs.week_start::text as week_start,
      count(*) filter (
        where c.created_at <= gs.week_start and (c.done_at is null or c.done_at > gs.week_start)
          and (c.archived_at is null or c.archived_at > gs.week_start)
      ) as open_count,
      count(*) filter (
        where c.created_at <= gs.week_start and (c.done_at is null or c.done_at > gs.week_start)
          and (c.archived_at is null or c.archived_at > gs.week_start)
          and c.due_at is not null and c.due_at < gs.week_start
      ) as overdue_count
    from generate_series(${weeks[0]}::date, ${weeks[weeks.length - 1]}::date, interval '7 days') as gs(week_start)
    cross join app.cards c
    where c.department_id = ${departmentId} and c.deleted_at is null and ${cardsFilterSql(filter, 'c')}
    group by gs.week_start
  `)
  const trendByWeek = new Map(trendRows.map((r) => [r.week_start, r]))
  const openVsOverdue = weeks.map((weekStart) => {
    const r = trendByWeek.get(weekStart)
    return {
      weekStart,
      openCount: Number(r?.open_count ?? 0),
      overdueCount: Number(r?.overdue_count ?? 0),
    }
  })

  return { throughput, onTimeRate: { overall, series }, openVsOverdue }
}

async function loadPerPerson(
  tx: Tx,
  departmentId: string,
  filter: ResolvedFilter,
): Promise<PersonLoad[]> {
  const rows = await tx.raw<{
    user_id: string
    given_name: string
    family_name: string
    open_count: string
    overdue_count: string
  }>(sql`
    select u.id as user_id, u.given_name, u.family_name,
      count(c.id) filter (where c.status = 'active') as open_count,
      count(c.id) filter (where c.status = 'active' and c.due_at is not null and c.due_at < now()) as overdue_count
    from app.memberships m
    join app.users u on u.id = m.user_id
    left join app.cards c on c.assignee_user_id = u.id and c.department_id = ${departmentId} and c.deleted_at is null
      and ${cardsFilterSql(filter, 'c')}
    where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null
    group by u.id, u.given_name, u.family_name
    order by open_count desc
  `)
  return rows.map((r) => ({
    userId: r.user_id,
    name: `${r.given_name} ${r.family_name}`.trim(),
    openCount: Number(r.open_count),
    overdueCount: Number(r.overdue_count),
  }))
}

async function loadPerUnit(
  tx: Tx,
  departmentId: string,
  filter: ResolvedFilter,
): Promise<UnitLoad[]> {
  // A member with no `unit_roles` row groups under `unitName: null` ("unassigned") -- structure's own
  // TECH-SPEC decision 12 ("UI complete without unit heads") applies equally here: a department with
  // no units at all still gets one correct "unassigned" bar, never an empty chart.
  const rows = await tx.raw<{
    unit_name: string | null
    open_count: string
    overdue_count: string
  }>(sql`
    select un.name as unit_name,
      count(c.id) filter (where c.status = 'active') as open_count,
      count(c.id) filter (where c.status = 'active' and c.due_at is not null and c.due_at < now()) as overdue_count
    from app.memberships m
    join app.users u on u.id = m.user_id
    left join app.unit_roles ur on ur.user_id = u.id and ur.department_id = ${departmentId} and ur.deleted_at is null
    left join app.units un on un.id = ur.unit_id and un.deleted_at is null
    left join app.cards c on c.assignee_user_id = u.id and c.department_id = ${departmentId} and c.deleted_at is null
      and ${cardsFilterSql(filter, 'c')}
    where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null
    group by un.name
    order by open_count desc
  `)
  return rows.map((r) => ({
    unitName: r.unit_name,
    openCount: Number(r.open_count),
    overdueCount: Number(r.overdue_count),
  }))
}

async function projectProgress(
  tx: Tx,
  departmentId: string,
  filter: ResolvedFilter,
): Promise<ProjectProgress[]> {
  // Project progress is inherently project-scoped, not person-scoped -- a `project:`/`status:` clause
  // still narrows which projects/tasks count, but an `assignee:`/`giver:`/`unit:` clause would make
  // "this project is 40% done" mean something different per viewer, so it is deliberately not applied
  // here (`cardsFilterSql` is not called against the task-count subquery below).
  const projectFilter =
    filter.projectIds !== null
      ? sql`and p.id = any(${sql.param(filter.projectIds)}::uuid[])`
      : sql``
  const statusFilter = filter.status !== null ? sql`and c.status = ${filter.status}` : sql``
  const rows = await tx.raw<{
    id: string
    title: string
    status: string
    total_tasks: string
    done_tasks: string
  }>(sql`
    select p.id, p.title, p.status,
      count(c.id) as total_tasks,
      count(c.id) filter (where c.status = 'done') as done_tasks
    from app.projects p
    left join app.cards c on c.project_id = p.id and c.deleted_at is null ${statusFilter}
    where p.department_id = ${departmentId} and p.deleted_at is null ${projectFilter}
    group by p.id, p.title, p.status
    order by p.created_at desc
  `)
  return rows.map((r) => {
    const total = Number(r.total_tasks)
    const done = Number(r.done_tasks)
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      totalTasks: total,
      doneTasks: done,
      progress: total > 0 ? done / total : 0,
    }
  })
}

async function eventsParticipation(
  tx: Tx,
  departmentId: string,
  since: string,
  until: string,
): Promise<EventParticipation[]> {
  const memberCountRows = await tx.raw<{ count: string }>(sql`
    select count(*) as count from app.memberships
    where department_id = ${departmentId} and status = 'active' and deleted_at is null
  `)
  const memberCount = Number(memberCountRows[0]?.count ?? 0)

  const rows = await tx.raw<{
    id: string
    title: string
    starts_at: Date
    yes_count: string
    no_count: string
    maybe_count: string
    waitlist_count: string
  }>(sql`
    select e.id, e.title, e.starts_at,
      count(r.id) filter (where r.status = 'yes') as yes_count,
      count(r.id) filter (where r.status = 'no') as no_count,
      count(r.id) filter (where r.status = 'maybe') as maybe_count,
      count(r.id) filter (where r.status = 'waitlist') as waitlist_count
    from app.events e
    left join app.event_rsvps r on r.event_id = e.id
    where e.department_id = ${departmentId} and e.deleted_at is null
      and e.starts_at >= ${new Date(`${since}T00:00:00+05:00`)}
      and e.starts_at < ${new Date(`${addDaysToDateString(until, 1)}T00:00:00+05:00`)}
    group by e.id, e.title, e.starts_at
    order by e.starts_at desc
    limit 50
  `)
  return rows.map((r) => {
    const yes = Number(r.yes_count)
    return {
      id: r.id,
      title: r.title,
      startsAt: r.starts_at,
      yes,
      no: Number(r.no_count),
      maybe: Number(r.maybe_count),
      waitlist: Number(r.waitlist_count),
      rsvpRate: memberCount > 0 ? Math.min(1, yes / memberCount) : 0,
    }
  })
}

async function pollTurnout(tx: Tx, departmentId: string): Promise<PollTurnout[]> {
  const memberCountRows = await tx.raw<{ count: string }>(sql`
    select count(*) as count from app.memberships
    where department_id = ${departmentId} and status = 'active' and deleted_at is null
  `)
  const memberCount = Number(memberCountRows[0]?.count ?? 0)

  const rows = await tx.raw<{ id: string; question: string; status: string; voters: string }>(sql`
    select p.id, p.question, p.status,
      count(distinct coalesce(pv.user_id::text, pv.voter_hash)) as voters
    from app.polls p
    left join app.poll_votes pv on pv.poll_id = p.id
    where p.department_id = ${departmentId}
    group by p.id, p.question, p.status
    order by p.created_at desc
    limit 50
  `)
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    status: r.status,
    voters: Number(r.voters),
    turnoutRate: memberCount > 0 ? Math.min(1, Number(r.voters) / memberCount) : 0,
  }))
}

async function personalOverview(
  tx: Tx,
  departmentId: string,
  viewerUserId: string,
): Promise<PersonalOverview> {
  const cardRows = await tx.raw<{
    open_count: string
    overdue_count: string
    done_this_week: string
    due_count: string
    on_time_count: string
  }>(sql`
    select
      count(*) filter (where status = 'active') as open_count,
      count(*) filter (where status = 'active' and due_at is not null and due_at < now()) as overdue_count,
      count(*) filter (where status = 'done' and done_at >= now() - interval '7 days') as done_this_week,
      count(*) filter (where status = 'done' and done_at >= now() - interval '7 days' and due_at is not null) as due_count,
      count(*) filter (
        where status = 'done' and done_at >= now() - interval '7 days' and due_at is not null and done_at <= due_at
      ) as on_time_count
    from app.cards
    where department_id = ${departmentId} and deleted_at is null and assignee_user_id = ${viewerUserId}
  `)
  const c = cardRows[0]

  // `app.pomodoro_sessions` is user-owned (I-1): safe to read here only because `toRequestContext`
  // below sets `ctx.userId = viewerUserId`, so RLS's `user_id = current_user_id()` scopes this to
  // the viewer's own sessions, exactly like `personal/repo.ts`'s own `getPomodoroStats`.
  const focusRows = await tx.raw<{ minutes: string }>(sql`
    select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60)
      filter (where kind = 'focus' and started_at >= now() - interval '7 days'), 0) as minutes
    from app.pomodoro_sessions where user_id = ${viewerUserId}
  `)

  const upcomingRows = await tx.raw<{ count: string }>(sql`
    select count(*) as count from app.event_rsvps r
    join app.events e on e.id = r.event_id
    where r.user_id = ${viewerUserId} and r.status = 'yes' and e.starts_at >= now() and e.deleted_at is null
  `)

  // Home's "needs my decision" (TECH-SPEC §5): work the viewer *gave out* that is now overdue -- a
  // different count than `overdue_count` above (which is the viewer's own overdue assignments).
  const givenRows = await tx.raw<{ count: string }>(sql`
    select count(*) as count from app.cards
    where department_id = ${departmentId} and deleted_at is null and giver_user_id = ${viewerUserId}
      and status = 'active' and due_at is not null and due_at < now()
  `)

  const due = Number(c?.due_count ?? 0)
  const onTime = Number(c?.on_time_count ?? 0)
  return {
    openCount: Number(c?.open_count ?? 0),
    overdueCount: Number(c?.overdue_count ?? 0),
    doneThisWeek: Number(c?.done_this_week ?? 0),
    onTimeRate: due > 0 ? onTime / due : null,
    focusMinutesThisWeek: Math.round(Number(focusRows[0]?.minutes ?? 0)),
    upcomingEventCount: Number(upcomingRows[0]?.count ?? 0),
    givenOverdueCount: Number(givenRows[0]?.count ?? 0),
  }
}

export async function getSummary(
  departmentId: string,
  viewerUserId: string,
  ctx: AuditCtx,
  query: { filter?: string | undefined; since?: string | undefined; until?: string | undefined },
): Promise<SummaryResult> {
  const until = query.until ?? tashkentDateString()
  const since = query.since ?? addDaysToDateString(until, -7 * 12) // 12 weeks, this page's default window

  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const filter = await resolveFilter(tx, departmentId, query.filter ?? '', viewerUserId)
    // The precomputed table has no concept of a person/unit/project/label/status/text restriction --
    // any such clause routes throughput/on-time/open-vs-overdue to the live path instead. A bare date
    // range (or an empty filter) is the common case and stays on the fast, precomputed path.
    const isFiltered =
      hasPersonRestriction(filter) ||
      filter.status !== null ||
      filter.projectIds !== null ||
      filter.labelIds !== null ||
      filter.textTerms.length > 0

    const trend = isFiltered
      ? await throughputAndOnTimeLive(tx, departmentId, since, until, filter)
      : await throughputAndOnTimeFromDaily(tx, departmentId, since, until)

    const [people, units, projects, events, polls, personal] = await Promise.all([
      loadPerPerson(tx, departmentId, filter),
      loadPerUnit(tx, departmentId, filter),
      projectProgress(tx, departmentId, filter),
      eventsParticipation(tx, departmentId, since, until),
      pollTurnout(tx, departmentId),
      personalOverview(tx, departmentId, viewerUserId),
    ])

    return {
      since,
      until,
      throughput: trend.throughput,
      onTimeRate: trend.onTimeRate,
      openVsOverdue: trend.openVsOverdue,
      loadPerPerson: people,
      loadPerUnit: units,
      projectProgress: projects,
      eventsParticipation: events,
      pollTurnout: polls,
      personal,
    }
  })
}

export async function getPersonalOverview(
  departmentId: string,
  viewerUserId: string,
  ctx: AuditCtx,
): Promise<PersonalOverview> {
  return withContext(toRequestContext(ctx, departmentId), (tx) =>
    personalOverview(tx, departmentId, viewerUserId),
  )
}

// ---------------------------------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------------------------------

export type MutationOutcome<T> = { ok: 'done'; row: T } | { ok: 'not_found' } | { ok: 'conflict' }

export type SavedFilterRow = {
  id: string
  name: string
  query: string
  since_days: number
  shared: boolean
  owner_user_id: string
  created_at: Date
  updated_at: Date
  version: number
}

const SAVED_FILTER_COLUMNS = sql.raw(
  'id, name, query, since_days, shared, owner_user_id, created_at, updated_at, version',
)

export async function listSavedFilters(
  departmentId: string,
  viewerUserId: string,
  ctx: AuditCtx,
): Promise<SavedFilterRow[]> {
  return withContext(toRequestContext(ctx, departmentId), (tx) =>
    tx.raw<SavedFilterRow>(sql`
      select ${SAVED_FILTER_COLUMNS} from app.analytics_saved_filters
      where department_id = ${departmentId} and deleted_at is null
        and (shared = true or owner_user_id = ${viewerUserId})
      order by created_at asc
    `),
  )
}

export async function createSavedFilter(
  departmentId: string,
  ownerUserId: string,
  input: { name: string; query: string; sinceDays: number; shared?: boolean | undefined },
  ctx: AuditCtx,
): Promise<SavedFilterRow> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<SavedFilterRow>(sql`
      insert into app.analytics_saved_filters (department_id, owner_user_id, name, query, since_days, shared)
      values (${departmentId}, ${ownerUserId}, ${input.name}, ${input.query}, ${input.sinceDays}, ${input.shared ?? false})
      returning ${SAVED_FILTER_COLUMNS}
    `)
    const row = rows[0]!
    tx.audit({
      action: 'analytics.saved_filter.created',
      subjectType: 'analytics_saved_filter',
      subjectId: row.id,
      departmentId,
      after: { name: row.name, query: row.query },
    })
    return row
  })
}

export async function patchSavedFilter(
  departmentId: string,
  ownerUserId: string,
  id: string,
  input: {
    name?: string | undefined
    query?: string | undefined
    sinceDays?: number | undefined
    shared?: boolean | undefined
    version: number
  },
  ctx: AuditCtx,
): Promise<MutationOutcome<SavedFilterRow>> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const setParts: SQL[] = []
    if (input.name !== undefined) setParts.push(sql`name = ${input.name}`)
    if (input.query !== undefined) setParts.push(sql`query = ${input.query}`)
    if (input.sinceDays !== undefined) setParts.push(sql`since_days = ${input.sinceDays}`)
    if (input.shared !== undefined) setParts.push(sql`shared = ${input.shared}`)
    setParts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<SavedFilterRow>(sql`
      update app.analytics_saved_filters set ${joinSet(setParts)}
      where id = ${id} and department_id = ${departmentId} and owner_user_id = ${ownerUserId}
        and version = ${input.version} and deleted_at is null
      returning ${SAVED_FILTER_COLUMNS}
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.analytics_saved_filters
        where id = ${id} and department_id = ${departmentId} and owner_user_id = ${ownerUserId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    tx.audit({
      action: 'analytics.saved_filter.updated',
      subjectType: 'analytics_saved_filter',
      subjectId: row.id,
      departmentId,
    })
    return { ok: 'done', row }
  })
}

export async function deleteSavedFilter(
  departmentId: string,
  ownerUserId: string,
  id: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.analytics_saved_filters set deleted_at = now(), updated_at = now(), version = version + 1
      where id = ${id} and department_id = ${departmentId} and owner_user_id = ${ownerUserId} and deleted_at is null
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({
      action: 'analytics.saved_filter.deleted',
      subjectType: 'analytics_saved_filter',
      subjectId: id,
      departmentId,
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------------
// Pinned charts (pin a chart to Home)
// ---------------------------------------------------------------------------------------------------

export type PinnedChartRow = {
  id: string
  chart_key: AnalyticsChartKey
  title: string
  filter_query: string
  sort: number
  created_at: Date
}

export async function listPinnedCharts(
  departmentId: string,
  ownerUserId: string,
  ctx: AuditCtx,
): Promise<PinnedChartRow[]> {
  return withContext(toRequestContext(ctx, departmentId), (tx) =>
    tx.raw<PinnedChartRow>(sql`
      select id, chart_key, title, filter_query, sort, created_at from app.analytics_pinned_charts
      where department_id = ${departmentId} and owner_user_id = ${ownerUserId}
      order by sort asc, created_at asc
    `),
  )
}

export async function pinChart(
  departmentId: string,
  ownerUserId: string,
  input: { chartKey: string; title: string; filterQuery?: string | undefined },
  ctx: AuditCtx,
): Promise<PinnedChartRow> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const max = await tx.raw<{ max_sort: number | null }>(sql`
      select max(sort) as max_sort from app.analytics_pinned_charts
      where department_id = ${departmentId} and owner_user_id = ${ownerUserId}
    `)
    const sort = (max[0]?.max_sort ?? -1) + 1
    const rows = await tx.raw<PinnedChartRow>(sql`
      insert into app.analytics_pinned_charts (department_id, owner_user_id, chart_key, title, filter_query, sort)
      values (${departmentId}, ${ownerUserId}, ${input.chartKey}, ${input.title}, ${input.filterQuery ?? ''}, ${sort})
      returning id, chart_key, title, filter_query, sort, created_at
    `)
    const row = rows[0]!
    tx.audit({
      action: 'analytics.chart.pinned',
      subjectType: 'analytics_pinned_chart',
      subjectId: row.id,
      departmentId,
      after: { chartKey: row.chart_key },
    })
    return row
  })
}

export async function unpinChart(
  departmentId: string,
  ownerUserId: string,
  id: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      delete from app.analytics_pinned_charts
      where id = ${id} and department_id = ${departmentId} and owner_user_id = ${ownerUserId}
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({
      action: 'analytics.chart.unpinned',
      subjectType: 'analytics_pinned_chart',
      subjectId: id,
      departmentId,
    })
    return true
  })
}

export async function reorderPinnedCharts(
  departmentId: string,
  ownerUserId: string,
  orderedIds: readonly string[],
  ctx: AuditCtx,
): Promise<number> {
  return withContext(toRequestContext(ctx, departmentId), async (tx) => {
    const valueRows = orderedIds.map((id, sort) => sql`(${id}::uuid, ${sort}::int)`)
    const rows = await tx.raw<{ id: string }>(sql`
      update app.analytics_pinned_charts as p set sort = v.sort
      from (values ${sql.join(valueRows, sql.raw(', '))}) as v(id, sort)
      where p.id = v.id and p.department_id = ${departmentId} and p.owner_user_id = ${ownerUserId}
      returning p.id
    `)
    if (rows.length > 0) {
      tx.audit({
        action: 'analytics.chart.reordered',
        subjectType: 'analytics_pinned_chart',
        subjectId: null,
        departmentId,
        after: { count: rows.length },
      })
    }
    return rows.length
  })
}

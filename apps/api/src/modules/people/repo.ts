// Batched indicator computation (v1.1 SPEC §4.2). One query per *source*, never one per person --
// the people table asks for 40 colleagues × 12 columns in a single request, so a per-person query
// would be 480 round trips for one screen (I-14, HARDENING H2.2 "no query in a loop").
//
// Every function here takes the whole cohort of user ids and returns a `Map<userId, value>`.
// `service.ts` assembles them into the registry's shape; nothing here knows about HTTP.
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'

export type UserNumbers = Map<string, number>

function emptyNumbers(): UserNumbers {
  return new Map<string, number>()
}

function toNumberMap(rows: readonly { user_id: string; value: string | number | null }[]): UserNumbers {
  const map = emptyNumbers()
  for (const row of rows) map.set(row.user_id, Number(row.value ?? 0))
  return map
}

export type CardIndicators = {
  openCards: UserNumbers
  overdueCards: UserNumbers
  dueThisWeek: UserNumbers
  doneLast30d: UserNumbers
  onTimeRate90d: UserNumbers
  cardsGivenOpen: UserNumbers
}

/**
 * Every card-shaped indicator in ONE pass over `app.cards`, aggregated per assignee with
 * `filter (where ...)` -- six numbers for the whole cohort in a single statement, using the
 * `cards_department_*` composite index (`0903_cards_composite_and_trigram_indexes.sql`).
 *
 * `onTimeRate90d` is expressed as a whole percent, and is `null`-free: a person with no due-dated
 * card finished in the window scores 100 rather than 0, because "never late" and "never asked" must
 * not look the same as "always late" on a management dashboard.
 */
export async function cardIndicators(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<CardIndicators> {
  if (userIds.length === 0) {
    return {
      openCards: emptyNumbers(),
      overdueCards: emptyNumbers(),
      dueThisWeek: emptyNumbers(),
      doneLast30d: emptyNumbers(),
      onTimeRate90d: emptyNumbers(),
      cardsGivenOpen: emptyNumbers(),
    }
  }
  const ids = sql.param([...userIds])
  const rows = await tx.raw<{
    user_id: string
    open_cards: string
    overdue_cards: string
    due_this_week: string
    done_last_30d: string
    due_last_90d: string
    on_time_last_90d: string
  }>(sql`
    select c.assignee_user_id as user_id,
           count(*) filter (where c.status = 'active')                                as open_cards,
           count(*) filter (where c.status = 'active' and c.due_at < now())           as overdue_cards,
           count(*) filter (
             where c.status = 'active'
               and c.due_at >= now()
               and c.due_at < now() + interval '7 days'
           )                                                                          as due_this_week,
           count(*) filter (where c.status = 'done' and c.done_at >= now() - interval '30 days')
                                                                                      as done_last_30d,
           count(*) filter (
             where c.status = 'done' and c.done_at >= now() - interval '90 days' and c.due_at is not null
           )                                                                          as due_last_90d,
           count(*) filter (
             where c.status = 'done' and c.done_at >= now() - interval '90 days'
               and c.due_at is not null and c.done_at <= c.due_at
           )                                                                          as on_time_last_90d
    from app.cards c
    where c.department_id = ${departmentId}
      and c.deleted_at is null
      and c.assignee_user_id = any(${ids}::uuid[])
    group by c.assignee_user_id
  `)

  const givenRows = await tx.raw<{ user_id: string; value: string }>(sql`
    select c.giver_user_id as user_id, count(*) as value
    from app.cards c
    where c.department_id = ${departmentId}
      and c.deleted_at is null
      and c.status = 'active'
      and c.giver_user_id = any(${ids}::uuid[])
    group by c.giver_user_id
  `)

  const openCards = emptyNumbers()
  const overdueCards = emptyNumbers()
  const dueThisWeek = emptyNumbers()
  const doneLast30d = emptyNumbers()
  const onTimeRate90d = emptyNumbers()
  for (const row of rows) {
    openCards.set(row.user_id, Number(row.open_cards))
    overdueCards.set(row.user_id, Number(row.overdue_cards))
    dueThisWeek.set(row.user_id, Number(row.due_this_week))
    doneLast30d.set(row.user_id, Number(row.done_last_30d))
    const due = Number(row.due_last_90d)
    onTimeRate90d.set(row.user_id, due === 0 ? 100 : Math.round((Number(row.on_time_last_90d) / due) * 100))
  }
  return {
    openCards,
    overdueCards,
    dueThisWeek,
    doneLast30d,
    onTimeRate90d,
    cardsGivenOpen: toNumberMap(givenRows),
  }
}

export type ProjectIndicators = { projects: UserNumbers; projectsOwned: UserNumbers }

/** Membership of a project is an array column, so this unnests once for the whole department rather
 * than running `= any(members)` per person. */
export async function projectIndicators(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<ProjectIndicators> {
  if (userIds.length === 0) return { projects: emptyNumbers(), projectsOwned: emptyNumbers() }
  const ids = sql.param([...userIds])
  const rows = await tx.raw<{ user_id: string; value: string }>(sql`
    select member_id as user_id, count(distinct project_id) as value
    from (
      select p.id as project_id, unnest(p.members || array[p.owner_user_id]) as member_id
      from app.projects p
      where p.department_id = ${departmentId} and p.deleted_at is null and p.status <> 'done'
    ) expanded
    where member_id = any(${ids}::uuid[])
    group by member_id
  `)
  const owned = await tx.raw<{ user_id: string; value: string }>(sql`
    select p.owner_user_id as user_id, count(*) as value
    from app.projects p
    where p.department_id = ${departmentId} and p.deleted_at is null
      and p.owner_user_id = any(${ids}::uuid[])
    group by p.owner_user_id
  `)
  return { projects: toNumberMap(rows), projectsOwned: toNumberMap(owned) }
}

export type EventIndicators = { eventsRsvpRate90d: UserNumbers; pollsTurnout: UserNumbers }

/** Participation as a percentage of what there was to participate in: the denominator is the
 * department's own count of events (and polls) in the window, computed once, not per person. */
export async function eventIndicators(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<EventIndicators> {
  if (userIds.length === 0)
    return { eventsRsvpRate90d: emptyNumbers(), pollsTurnout: emptyNumbers() }
  const ids = sql.param([...userIds])

  const totals = await tx.raw<{ events: string; polls: string }>(sql`
    select
      (select count(*) from app.events e
        where e.department_id = ${departmentId}
          and e.deleted_at is null
          and e.starts_at >= now() - interval '90 days'
          and e.starts_at < now())                                         as events,
      (select count(*) from app.polls p
        where p.department_id = ${departmentId})                            as polls
  `)
  const eventTotal = Number(totals[0]?.events ?? 0)
  const pollTotal = Number(totals[0]?.polls ?? 0)

  const rsvps = await tx.raw<{ user_id: string; value: string }>(sql`
    select r.user_id, count(distinct r.event_id) as value
    from app.event_rsvps r
    join app.events e on e.id = r.event_id
    where r.department_id = ${departmentId}
      and r.status = 'yes'
      and e.starts_at >= now() - interval '90 days'
      and e.starts_at < now()
      and r.user_id = any(${ids}::uuid[])
    group by r.user_id
  `)
  const votes = await tx.raw<{ user_id: string; value: string }>(sql`
    select v.user_id, count(distinct v.poll_id) as value
    from app.poll_votes v
    where v.department_id = ${departmentId}
      and v.user_id = any(${ids}::uuid[])
    group by v.user_id
  `)

  const pct = (counts: UserNumbers, total: number): UserNumbers => {
    const out = emptyNumbers()
    for (const userId of userIds) {
      const n = counts.get(userId) ?? 0
      out.set(userId, total === 0 ? 0 : Math.round((n / total) * 100))
    }
    return out
  }
  return {
    eventsRsvpRate90d: pct(toNumberMap(rsvps), eventTotal),
    pollsTurnout: pct(toNumberMap(votes), pollTotal),
  }
}

export type DirectoryRow = {
  userId: string
  unit: string | null
  unitRole: string | null
  title: string | null
  joinedAt: string
  telegramLinked: boolean
  hasAvatar: boolean
  lastActiveAt: string | null
}

/** The directory facts plus `lastActiveAt`. One query: memberships joined to users, their single
 * active unit assignment, their Telegram link and their most recent session activity. */
export async function directoryRows(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<DirectoryRow[]> {
  if (userIds.length === 0) return []
  const ids = sql.param([...userIds])
  const rows = await tx.raw<{
    user_id: string
    unit: string | null
    unit_role: string | null
    title: string | null
    joined_at: Date | string
    telegram_linked: boolean
    has_avatar: boolean
    last_active_at: Date | string | null
  }>(sql`
    select m.user_id,
           un.name        as unit,
           ur.role::text  as unit_role,
           coalesce(m.title_override, u.title) as title,
           m.joined_at,
           (u.avatar_key is not null) as has_avatar,
           (tl.user_id is not null) as telegram_linked,
           s.last_seen_at as last_active_at
    from app.memberships m
    join app.users u on u.id = m.user_id
    left join app.unit_roles ur
      on ur.user_id = m.user_id and ur.department_id = m.department_id and ur.deleted_at is null
    left join app.units un on un.id = ur.unit_id and un.deleted_at is null
    left join app.telegram_links tl on tl.user_id = m.user_id
    left join lateral (
      select max(x.last_seen_at) as last_seen_at
      from app.sessions x
      where x.user_id = m.user_id
    ) s on true
    where m.department_id = ${departmentId}
      and m.status = 'active'
      and m.deleted_at is null
      and m.user_id = any(${ids}::uuid[])
  `)
  return rows.map((r) => ({
    userId: r.user_id,
    unit: r.unit,
    unitRole: r.unit_role,
    title: r.title,
    joinedAt: new Date(r.joined_at).toISOString(),
    telegramLinked: r.telegram_linked,
    hasAvatar: r.has_avatar,
    lastActiveAt: r.last_active_at ? new Date(r.last_active_at).toISOString() : null,
  }))
}

/**
 * Onboarding progress, expressed over the four department-visible steps the member's own Home
 * checklist already shows them (`features/home/home-screen.tsx`): a photo, a first card, a first
 * RSVP, a linked Telegram.
 *
 * Deliberately NOT read from `app.onboarding_runs`: a run's actual items are created as **personal
 * tasks**, which are owner-only with no head branch in RLS and must stay that way (I-1). Counting
 * four public signals tells the head exactly what they need ("this newcomer has not started") while
 * the newcomer's private workspace stays private. `onboarding_runs` is still the row that says a
 * checklist was handed out, and is joined here only to know whether a run exists at all.
 */
export async function onboardingStarted(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const ids = sql.param([...userIds])
  const rows = await tx.raw<{ user_id: string }>(sql`
    select distinct r.user_id
    from app.onboarding_runs r
    where r.department_id = ${departmentId} and r.user_id = any(${ids}::uuid[])
  `)
  return new Set(rows.map((r) => r.user_id))
}

/**
 * Aggregate focus minutes over the last 7 days (SPEC §4.2, audit §4.7). Routed through
 * `app.focus_minutes_by_user` -- a `security definer` function that checks for itself that the
 * caller is the head of this department and can only ever return `(user_id, minutes)`. The
 * `personal_*` tables stay owner-only with no head branch in RLS (I-1); this is the one aggregate
 * the matrix allows, and it is physically incapable of carrying a note, a task title or a canvas.
 */
export async function focusMinutes7d(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<UserNumbers> {
  if (userIds.length === 0) return emptyNumbers()
  const wanted = new Set(userIds)
  const rows = await tx.raw<{ user_id: string; minutes: number | string }>(sql`
    select user_id, minutes
    from app.focus_minutes_by_user(${departmentId}::uuid, now() - interval '7 days')
  `)
  const out = emptyNumbers()
  for (const row of rows) {
    if (wanted.has(row.user_id)) out.set(row.user_id, Number(row.minutes ?? 0))
  }
  return out
}

/** The department's active member ids, in board order (head first, then by name). */
export async function activeMemberIds(
  ctx: RequestContext,
  departmentId: string,
): Promise<string[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ user_id: string }>(sql`
      select m.user_id
      from app.memberships m
      join app.users u on u.id = m.user_id
      where m.department_id = ${departmentId}
        and m.status = 'active'
        and m.deleted_at is null
        and u.deleted_at is null
      order by (m.role = 'head') desc, u.given_name asc, u.family_name asc
    `)
    return rows.map((r) => r.user_id)
  })
}

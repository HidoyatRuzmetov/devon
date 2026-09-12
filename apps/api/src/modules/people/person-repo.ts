// The person page's data (v1.1 SPEC §6). Everything a head sees about one xodim -- and everything a
// xodim sees about themselves on `/people/me` -- comes from this file.
//
// Two rules it never breaks:
//  * I-1. Nothing here reads a `personal_*` row. The focus figure on the person page is the same
//    aggregate `repo.focusMinutes7d` serves, through the same `security definer` function whose
//    return type is physically `(user_id, minutes)`. There is no code path from this file to a note,
//    a personal task title, a canvas or a Pomodoro label.
//  * I-14. One query per section, never one per card/project/event. A person page is eight
//    statements, not eighty.
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'

export type PersonHeader = {
  userId: string
  givenName: string
  familyName: string
  patronymic: string | null
  title: string | null
  avatarKey: string | null
  unitId: string | null
  unit: string | null
  unitRole: string | null
  membershipRole: 'head' | 'member'
  joinedAt: string
  lastActiveAt: string | null
  telegramLinked: boolean
  /** `tg://user?id=…`, built server-side so the raw chat id never becomes a field the client logs.
   * `null` unless the person actually linked Telegram (SPEC §4.3 "if linked"). */
  telegramDeepLink: string | null
  locale: string
  timezone: string
}

export async function personHeader(
  tx: Tx,
  departmentId: string,
  userId: string,
  includeTelegramLink: boolean,
): Promise<PersonHeader | null> {
  const rows = await tx.raw<{
    user_id: string
    given_name: string
    family_name: string
    patronymic: string | null
    title: string | null
    avatar_key: string | null
    unit_id: string | null
    unit: string | null
    unit_role: string | null
    membership_role: 'head' | 'member'
    joined_at: Date | string
    last_active_at: Date | string | null
    chat_id: string | number | null
    locale: string
    timezone: string
  }>(sql`
    select m.user_id,
           u.given_name,
           u.family_name,
           u.patronymic,
           coalesce(m.title_override, u.title) as title,
           u.avatar_key,
           u.locale,
           u.timezone,
           un.id          as unit_id,
           un.name        as unit,
           ur.role::text  as unit_role,
           m.role::text   as membership_role,
           m.joined_at,
           s.last_seen_at as last_active_at,
           tl.chat_id
    from app.memberships m
    join app.users u on u.id = m.user_id
    left join app.unit_roles ur
      on ur.user_id = m.user_id and ur.department_id = m.department_id and ur.deleted_at is null
    left join app.units un on un.id = ur.unit_id and un.deleted_at is null
    left join app.telegram_links tl on tl.user_id = m.user_id and tl.unlinked_at is null
    left join lateral (
      select max(x.last_seen_at) as last_seen_at from app.sessions x where x.user_id = m.user_id
    ) s on true
    where m.department_id = ${departmentId}
      and m.user_id = ${userId}
      and m.status = 'active'
      and m.deleted_at is null
      and u.deleted_at is null
  `)
  const row = rows[0]
  if (!row) return null
  return {
    userId: row.user_id,
    givenName: row.given_name,
    familyName: row.family_name,
    patronymic: row.patronymic,
    title: row.title,
    avatarKey: row.avatar_key,
    unitId: row.unit_id,
    unit: row.unit,
    unitRole: row.unit_role,
    membershipRole: row.membership_role,
    joinedAt: new Date(row.joined_at).toISOString(),
    lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : null,
    telegramLinked: row.chat_id !== null && row.chat_id !== undefined,
    telegramDeepLink:
      includeTelegramLink && row.chat_id !== null && row.chat_id !== undefined
        ? `tg://user?id=${String(row.chat_id)}`
        : null,
    locale: row.locale,
    timezone: row.timezone,
  }
}

export type WeekPoint = { week: string; done: number; created: number }

/** Throughput, twelve weeks, by ISO week start (Monday) -- one `generate_series` join so a quiet week
 * is a zero on the chart rather than a gap in the line. */
export async function throughputByWeek(
  tx: Tx,
  departmentId: string,
  userId: string,
  weeks: number,
): Promise<WeekPoint[]> {
  // Two correlated counts rather than two LEFT JOINs: joining `done` and `created` to the same week
  // row would multiply them by each other (four done × three created = twelve of each). Twelve weeks
  // of scalar subqueries is still one statement and one index scan per week.
  const rows = await tx.raw<{ week: Date | string; done: string; created: string }>(sql`
    with series as (
      select generate_series(
        date_trunc('week', now()) - make_interval(weeks => ${weeks - 1}::int),
        date_trunc('week', now()),
        interval '1 week'
      ) as week
    )
    select s.week,
           (select count(*) from app.cards d
             where d.department_id = ${departmentId}
               and d.deleted_at is null
               and d.assignee_user_id = ${userId}
               and d.status = 'done'
               and date_trunc('week', d.done_at) = s.week) as done,
           (select count(*) from app.cards c
             where c.department_id = ${departmentId}
               and c.deleted_at is null
               and c.assignee_user_id = ${userId}
               and date_trunc('week', c.created_at) = s.week) as created
    from series s
    order by s.week
  `)
  return rows.map((r) => ({
    week: new Date(r.week).toISOString(),
    done: Number(r.done),
    created: Number(r.created),
  }))
}

export type OnTimePoint = { week: string; rate: number | null; finished: number }

/** On-time trend over the same twelve weeks. `rate` is `null` (a gap, not a zero) for a week in which
 * nothing with a due date was finished -- WALKTHROUGH-FINDINGS §4.1: an on-time percentage whose
 * denominator is invisible is the bug, not the number. */
export async function onTimeTrend(
  tx: Tx,
  departmentId: string,
  userId: string,
  weeks: number,
): Promise<OnTimePoint[]> {
  const rows = await tx.raw<{ week: Date | string; finished: string; on_time: string }>(sql`
    with series as (
      select generate_series(
        date_trunc('week', now()) - make_interval(weeks => ${weeks - 1}::int),
        date_trunc('week', now()),
        interval '1 week'
      ) as week
    )
    select s.week,
           count(c.id)                                       as finished,
           count(c.id) filter (where c.done_at <= c.due_at)  as on_time
    from series s
    left join app.cards c
      on c.department_id = ${departmentId}
     and c.deleted_at is null
     and c.assignee_user_id = ${userId}
     and c.status = 'done'
     and c.due_at is not null
     and date_trunc('week', c.done_at) = s.week
    group by s.week
    order by s.week
  `)
  return rows.map((r) => {
    const finished = Number(r.finished)
    return {
      week: new Date(r.week).toISOString(),
      finished,
      rate: finished === 0 ? null : Math.round((Number(r.on_time) / finished) * 100),
    }
  })
}

export type ProjectLoad = {
  projectId: string | null
  title: string | null
  colour: string | null
  open: number
  overdue: number
}

/** Open load split by project, including the "no project" bucket -- the answer to "what is this
 * person actually carrying this week". */
export async function loadByProject(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<ProjectLoad[]> {
  const rows = await tx.raw<{
    project_id: string | null
    title: string | null
    colour: string | null
    open: string
    overdue: string
  }>(sql`
    select c.project_id,
           p.title,
           p.colour,
           count(*)                                       as open,
           count(*) filter (where c.due_at < now())       as overdue
    from app.cards c
    left join app.projects p on p.id = c.project_id and p.deleted_at is null
    where c.department_id = ${departmentId}
      and c.deleted_at is null
      and c.status = 'active'
      and c.assignee_user_id = ${userId}
    group by c.project_id, p.title, p.colour
    order by count(*) desc
  `)
  return rows.map((r) => ({
    projectId: r.project_id,
    title: r.title,
    colour: r.colour,
    open: Number(r.open),
    overdue: Number(r.overdue),
  }))
}

export type PersonCard = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  risk: 'none' | 'at_risk' | 'overdue'
  dueAt: string | null
  doneAt: string | null
  projectId: string | null
  projectTitle: string | null
  giverUserId: string | null
  assigneeUserId: string | null
  createdAt: string
}

type CardRaw = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: PersonCard['priority']
  due_at: Date | string | null
  done_at: Date | string | null
  project_id: string | null
  project_title: string | null
  giver_user_id: string | null
  assignee_user_id: string | null
  created_at: Date | string
}

/** The same three-step risk `apps/api/src/modules/work/repo.ts` computes, restated here rather than
 * imported across a module boundary: two days of runway is the department's definition of "at risk",
 * and both copies are covered by their own module's tests. */
function riskOf(status: string, dueAt: Date | string | null): PersonCard['risk'] {
  if (status !== 'active' || !dueAt) return 'none'
  const due = new Date(dueAt).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now <= 2 * 24 * 60 * 60 * 1000) return 'at_risk'
  return 'none'
}

function toCard(row: CardRaw): PersonCard {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    risk: riskOf(row.status, row.due_at),
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    doneAt: row.done_at ? new Date(row.done_at).toISOString() : null,
    projectId: row.project_id,
    projectTitle: row.project_title,
    giverUserId: row.giver_user_id,
    assigneeUserId: row.assignee_user_id,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

const CARD_COLUMNS = sql`
  c.id, c.title, c.status, c.priority, c.due_at, c.done_at, c.project_id,
  p.title as project_title, c.giver_user_id, c.assignee_user_id, c.created_at
`

/** The person's cards. `role` picks the axis: work they were *given* (assignee, the default) or work
 * they *gave* out (giver) -- SPEC §6 "their cards ... giver and assignee both". */
export async function personCards(
  tx: Tx,
  departmentId: string,
  userId: string,
  options: { role: 'assignee' | 'giver'; status: 'active' | 'done' | 'all'; limit: number },
): Promise<PersonCard[]> {
  const roleClause =
    options.role === 'giver'
      ? sql`c.giver_user_id = ${userId}`
      : sql`c.assignee_user_id = ${userId}`
  const statusClause =
    options.status === 'all'
      ? sql`c.status <> 'archived'`
      : sql`c.status = ${options.status}::app.card_status`
  const rows = await tx.raw<CardRaw>(sql`
    select ${CARD_COLUMNS}
    from app.cards c
    left join app.projects p on p.id = c.project_id and p.deleted_at is null
    where c.department_id = ${departmentId}
      and c.deleted_at is null
      and ${roleClause}
      and ${statusClause}
    order by (c.due_at is null), c.due_at asc, c.created_at desc
    limit ${options.limit}
  `)
  return rows.map(toCard)
}

/** The overdue and at-risk half of `personCards`, in one small query for the Overview tab's risk
 * list -- so opening the page does not fetch a hundred cards to show five. */
export async function riskCards(
  tx: Tx,
  departmentId: string,
  userId: string,
  limit: number,
): Promise<PersonCard[]> {
  const rows = await tx.raw<CardRaw>(sql`
    select ${CARD_COLUMNS}
    from app.cards c
    left join app.projects p on p.id = c.project_id and p.deleted_at is null
    where c.department_id = ${departmentId}
      and c.deleted_at is null
      and c.status = 'active'
      and c.assignee_user_id = ${userId}
      and c.due_at is not null
      and c.due_at < now() + interval '2 days'
    order by c.due_at asc
    limit ${limit}
  `)
  return rows.map(toCard)
}

export type PersonProject = {
  id: string
  title: string
  colour: string
  status: string
  role: 'owner' | 'member'
  targetOn: string | null
  totalCards: number
  doneCards: number
}

/** Projects with this person's role and the project's own progress. One query: the membership test
 * and the card counts are a single join, never a count per project (I-14). */
export async function personProjects(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<PersonProject[]> {
  const rows = await tx.raw<{
    id: string
    title: string
    colour: string
    status: string
    is_owner: boolean
    target_on: Date | string | null
    total_cards: string
    done_cards: string
  }>(sql`
    select p.id,
           p.title,
           p.colour,
           p.status::text as status,
           (p.owner_user_id = ${userId}) as is_owner,
           p.target_on,
           count(c.id)                                     as total_cards,
           count(c.id) filter (where c.status = 'done')    as done_cards
    from app.projects p
    left join app.cards c
      on c.project_id = p.id and c.deleted_at is null and c.department_id = p.department_id
    where p.department_id = ${departmentId}
      and p.deleted_at is null
      and (p.owner_user_id = ${userId} or ${userId}::uuid = any(p.members))
    group by p.id, p.title, p.colour, p.status, p.owner_user_id, p.target_on
    order by (p.status = 'done'), p.target_on asc nulls last, p.title asc
  `)
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    colour: r.colour,
    status: r.status,
    role: r.is_owner ? ('owner' as const) : ('member' as const),
    targetOn: r.target_on ? new Date(r.target_on).toISOString() : null,
    totalCards: Number(r.total_cards),
    doneCards: Number(r.done_cards),
  }))
}

export type PersonEvent = {
  id: string
  title: string
  startsAt: string
  category: string
  rsvp: string | null
  guests: number
  drivesCarpool: boolean
  claimedSeat: boolean
}

/** Events this person answered, with the carpool facts attached. Two months back, everything ahead. */
export async function personEvents(
  tx: Tx,
  departmentId: string,
  userId: string,
  limit: number,
): Promise<PersonEvent[]> {
  const rows = await tx.raw<{
    id: string
    title: string
    starts_at: Date | string
    category: string
    rsvp: string | null
    guests: number | null
    drives: boolean
    claimed: boolean
  }>(sql`
    select e.id,
           e.title,
           e.starts_at,
           e.category::text as category,
           r.status::text   as rsvp,
           r.guests,
           (cp.id is not null) as drives,
           (cs.id is not null) as claimed
    from app.events e
    left join app.event_rsvps r on r.event_id = e.id and r.user_id = ${userId}
    left join lateral (
      select c.id from app.carpools c
      where c.event_id = e.id and c.driver_user_id = ${userId} limit 1
    ) cp on true
    left join lateral (
      select s.id from app.carpool_seats s
      join app.carpools c2 on c2.id = s.carpool_id
      where c2.event_id = e.id and s.user_id = ${userId} limit 1
    ) cs on true
    where e.department_id = ${departmentId}
      and e.deleted_at is null
      and e.starts_at >= now() - interval '60 days'
      and (r.id is not null or cp.id is not null or cs.id is not null)
    order by e.starts_at desc
    limit ${limit}
  `)
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: new Date(r.starts_at).toISOString(),
    category: r.category,
    rsvp: r.rsvp,
    guests: Number(r.guests ?? 0),
    drivesCarpool: r.drives,
    claimedSeat: r.claimed,
  }))
}

export type PollParticipation = { voted: number; total: number }

export async function personPolls(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<PollParticipation> {
  const rows = await tx.raw<{ voted: string; total: string }>(sql`
    select
      (select count(distinct v.poll_id) from app.poll_votes v
        where v.department_id = ${departmentId} and v.user_id = ${userId})  as voted,
      (select count(*) from app.polls p where p.department_id = ${departmentId}) as total
  `)
  return { voted: Number(rows[0]?.voted ?? 0), total: Number(rows[0]?.total ?? 0) }
}

export type OnboardingStep = { key: string; done: boolean }
export type PersonOnboarding = {
  hasRun: boolean
  steps: OnboardingStep[]
  percent: number
}

/**
 * The four department-visible onboarding signals -- exactly the ones the newcomer's own Home
 * checklist shows them, and exactly the ones `repo.onboardingStarted` documents. Deliberately NOT
 * read from the run's personal tasks (I-1): the head learns "this newcomer has not started", never
 * what is written inside their private workspace.
 */
export async function personOnboarding(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<PersonOnboarding> {
  const rows = await tx.raw<{
    has_avatar: boolean
    has_card: boolean
    has_rsvp: boolean
    has_telegram: boolean
    has_run: boolean
  }>(sql`
    select (u.avatar_key is not null) as has_avatar,
           exists (select 1 from app.cards c
                    where c.department_id = ${departmentId} and c.deleted_at is null
                      and c.assignee_user_id = ${userId}) as has_card,
           exists (select 1 from app.event_rsvps r
                    where r.department_id = ${departmentId} and r.user_id = ${userId}) as has_rsvp,
           exists (select 1 from app.telegram_links t
                    where t.user_id = ${userId} and t.unlinked_at is null) as has_telegram,
           exists (select 1 from app.onboarding_runs o
                    where o.department_id = ${departmentId} and o.user_id = ${userId}) as has_run
    from app.users u
    where u.id = ${userId}
  `)
  const row = rows[0]
  const steps: OnboardingStep[] = [
    { key: 'photo', done: row?.has_avatar === true },
    { key: 'work', done: row?.has_card === true },
    { key: 'event', done: row?.has_rsvp === true },
    { key: 'telegram', done: row?.has_telegram === true },
  ]
  const done = steps.filter((s) => s.done).length
  return {
    hasRun: row?.has_run === true,
    steps,
    percent: Math.round((done / steps.length) * 100),
  }
}

export type ActivityEntry = {
  at: string
  kind: string
  cardId: string | null
  cardTitle: string | null
  eventId: string | null
  eventTitle: string | null
  data: Record<string, unknown>
}

/**
 * The work timeline (SPEC §6 "Faollik ... work only, never personal workspace content"). A union of
 * three department-owned sources -- card activity this person caused, cards they were given, and
 * event answers they gave -- ordered once and cut to `limit`. No `audit.events` read: the audit log
 * is its own subject kind with its own screen, and mirroring it here would leak rows the person page
 * has no business showing.
 */
export async function personActivity(
  tx: Tx,
  departmentId: string,
  userId: string,
  limit: number,
): Promise<ActivityEntry[]> {
  const rows = await tx.raw<{
    at: Date | string
    kind: string
    card_id: string | null
    card_title: string | null
    event_id: string | null
    event_title: string | null
    data: Record<string, unknown> | null
  }>(sql`
    (
      select a.at, a.kind, a.card_id, c.title as card_title,
             null::uuid as event_id, null::text as event_title, a.data
      from app.card_activity a
      join app.cards c on c.id = a.card_id and c.deleted_at is null
      where a.department_id = ${departmentId} and a.actor_user_id = ${userId}
      order by a.at desc
      limit ${limit}
    )
    union all
    (
      select c.created_at as at, 'card.assigned' as kind, c.id as card_id, c.title as card_title,
             null::uuid as event_id, null::text as event_title, '{}'::jsonb as data
      from app.cards c
      where c.department_id = ${departmentId} and c.deleted_at is null
        and c.assignee_user_id = ${userId}
      order by c.created_at desc
      limit ${limit}
    )
    union all
    (
      select r.changed_at as at, 'event.rsvp' as kind, null::uuid as card_id, null::text as card_title,
             e.id as event_id, e.title as event_title,
             jsonb_build_object('status', r.status::text) as data
      from app.event_rsvps r
      join app.events e on e.id = r.event_id and e.deleted_at is null
      where r.department_id = ${departmentId} and r.user_id = ${userId}
      order by r.changed_at desc
      limit ${limit}
    )
    order by at desc
    limit ${limit}
  `)
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    cardId: r.card_id,
    cardTitle: r.card_title,
    eventId: r.event_id,
    eventTitle: r.event_title,
    data: r.data ?? {},
  }))
}

/** Everything the Overview tab needs, in one transaction and one round trip from the route. */
export async function personOverview(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  options: { includeTelegramLink: boolean; weeks: number },
) {
  return withContext(ctx, async (tx) => {
    const header = await personHeader(tx, departmentId, userId, options.includeTelegramLink)
    if (!header) return null
    const [throughput, onTime, load, risks, projects, events, polls, onboarding] =
      await Promise.all([
        throughputByWeek(tx, departmentId, userId, options.weeks),
        onTimeTrend(tx, departmentId, userId, options.weeks),
        loadByProject(tx, departmentId, userId),
        riskCards(tx, departmentId, userId, 8),
        personProjects(tx, departmentId, userId),
        personEvents(tx, departmentId, userId, 20),
        personPolls(tx, departmentId, userId),
        personOnboarding(tx, departmentId, userId),
      ])
    return { header, throughput, onTime, load, risks, projects, events, polls, onboarding }
  })
}

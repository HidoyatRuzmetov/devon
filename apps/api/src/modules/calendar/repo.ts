// Calendar feeds and the queries behind every feed body (v1.1 SPEC §10, EPIC-019).
//
// Two things worth reading before changing anything here:
//
//   * `app.calendar_feeds` carries no RLS policy, and that is deliberate -- migration 1800 explains
//     it in full. A calendar client sends no cookie, so the secret in the URL has to be resolved to a
//     user id *before* any context exists; that is the same bootstrap shape as `app.sessions` and
//     `app.telegram_links`, both `global` for exactly this reason. The consequence is a rule this
//     file keeps without exception: **every authenticated query below carries its own
//     `user_id = <caller>` predicate**, because the database is not adding one.
//
//   * A person's calendar spans every department they are an active member of, and `app.events` /
//     `app.cards` are both scoped by RLS to one department GUC at a time. So the feed resolves the
//     memberships once and then runs one union query per department -- one, in every real case, since
//     a xodim belongs to one boshqarma. That is a bounded fan-out over a set the first query
//     returned, never a query per row (I-14); the alternative, a `security definer` function, does
//     not work here at all: `devon_migrator` owns every table under `force row level security`, so a
//     function it owns is bound by exactly the policies its caller would have been.
import { randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AuditCtx } from '../../types.js'
import type { CalendarItem } from './ics.js'

export type FeedKind = 'all' | 'events' | 'tasks'

export type FeedRow = {
  id: string
  kind: FeedKind
  secret: string
  label: string
  createdAt: Date
  rotatedAt: Date | null
  revokedAt: Date | null
  lastAccessedAt: Date | null
  accessCount: number
}

type FeedSqlRow = {
  id: string
  kind: FeedKind
  secret: string
  label: string
  created_at: Date | string
  rotated_at: Date | string | null
  revoked_at: Date | string | null
  last_accessed_at: Date | string | null
  access_count: number
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

function toFeed(r: FeedSqlRow): FeedRow {
  return {
    id: r.id,
    kind: r.kind,
    secret: r.secret,
    label: r.label,
    createdAt: toDate(r.created_at),
    rotatedAt: r.rotated_at === null ? null : toDate(r.rotated_at),
    revokedAt: r.revoked_at === null ? null : toDate(r.revoked_at),
    lastAccessedAt: r.last_accessed_at === null ? null : toDate(r.last_accessed_at),
    accessCount: r.access_count,
  }
}

function toRequestContext(ctx: AuditCtx, extra: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId: null,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ...extra,
  }
}

function systemCtx(userId: string | null): AuditCtx {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: null,
    actingForUserId: null,
    ip: '',
    userAgent: 'devon-calendar/system',
  }
}

/** 32 bytes of CSPRNG output, base64url. Long enough that guessing is not a threat model, short
 * enough to paste into Outlook's "subscribe from web" box without wrapping. */
export function newFeedSecret(): string {
  return randomBytes(32).toString('base64url')
}

const FEED_SELECT = sql`
  select id, kind, secret, label, created_at, rotated_at, revoked_at, last_accessed_at, access_count
  from app.calendar_feeds
`

export async function listFeeds(userId: string): Promise<FeedRow[]> {
  return withContext(toRequestContext(systemCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<FeedSqlRow>(sql`
      ${FEED_SELECT}
      where user_id = ${userId} and revoked_at is null
      order by created_at asc limit 20
    `)
    return rows.map(toFeed)
  })
}

export async function createFeed(
  ctx: AuditCtx,
  userId: string,
  kind: FeedKind,
  label: string,
): Promise<FeedRow> {
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<FeedSqlRow>(sql`
      insert into app.calendar_feeds (user_id, kind, secret, label)
      values (${userId}, ${kind}::app.calendar_feed_kind, ${newFeedSecret()}, ${label})
      returning id, kind, secret, label, created_at, rotated_at, revoked_at, last_accessed_at,
                access_count
    `)
    const row = rows[0]
    if (!row) throw new Error('calendar: feed insert returned no row')
    tx.audit({
      action: 'calendar.feed_created',
      subjectType: 'calendar_feed',
      subjectId: row.id,
      // The secret is the credential; it never enters the audit trail (the audit redactor would not
      // catch a column called `secret` on its own, so this is a deliberate omission, not luck).
      after: { kind: row.kind, label: row.label },
    })
    tx.emit({ type: 'calendar.feed.created', payload: { feedId: row.id, userId, kind } })
    return toFeed(row)
  })
}

/** Regenerate: the old URL stops working immediately, which is the entire point -- a feed URL that
 * leaked (a shared phone, a screenshot in a chat) has to be revocable by the person themselves
 * without an administrator. */
export async function rotateFeed(
  ctx: AuditCtx,
  userId: string,
  feedId: string,
): Promise<FeedRow | null> {
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<FeedSqlRow>(sql`
      update app.calendar_feeds
      set secret = ${newFeedSecret()}, rotated_at = now(), access_count = 0, last_accessed_at = null
      where id = ${feedId} and user_id = ${userId} and revoked_at is null
      returning id, kind, secret, label, created_at, rotated_at, revoked_at, last_accessed_at,
                access_count
    `)
    const row = rows[0]
    if (!row) return null
    tx.audit({
      action: 'calendar.feed_rotated',
      subjectType: 'calendar_feed',
      subjectId: row.id,
      after: { kind: row.kind },
    })
    tx.emit({ type: 'calendar.feed.rotated', payload: { feedId: row.id, userId } })
    return toFeed(row)
  })
}

export async function revokeFeed(
  ctx: AuditCtx,
  userId: string,
  feedId: string,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.calendar_feeds set revoked_at = now()
      where id = ${feedId} and user_id = ${userId} and revoked_at is null
      returning id
    `)
    const row = rows[0]
    if (!row) return false
    tx.audit({
      action: 'calendar.feed_revoked',
      subjectType: 'calendar_feed',
      subjectId: row.id,
    })
    tx.emit({ type: 'calendar.feed.revoked', payload: { feedId: row.id, userId } })
    return true
  })
}

export type ResolvedFeed = { id: string; userId: string; kind: FeedKind }

/** Secret -> feed, with no session. Returns `null` for an unknown *and* for a revoked secret: a
 * calendar client must not be able to tell "never existed" from "you revoked this", and neither
 * answer is more useful than "404, stop asking". */
export async function resolveFeed(secret: string): Promise<ResolvedFeed | null> {
  if (secret.length < 16 || secret.length > 128) return null
  return withContext(toRequestContext(systemCtx(null)), async (tx) => {
    const rows = await tx.raw<{ id: string; user_id: string; kind: FeedKind }>(sql`
      select id, user_id, kind from app.calendar_feeds
      where secret = ${secret} and revoked_at is null
      limit 1
    `)
    const row = rows[0]
    if (!row) return null
    return { id: row.id, userId: row.user_id, kind: row.kind }
  })
}

export async function touchFeed(feedId: string, userId: string): Promise<void> {
  await withContext(toRequestContext(systemCtx(userId), { userId }), async (tx) => {
    await tx.raw(sql`
      update app.calendar_feeds
      set last_accessed_at = now(), access_count = access_count + 1
      where id = ${feedId} and user_id = ${userId}
    `)
  })
}

type ItemSqlRow = {
  item_id: string
  item_kind: 'event' | 'card'
  title: string
  body: string
  starts_at: Date | string
  ends_at: Date | string
  place: string
  deep_link: string
  status: string
  updated_at: Date | string
}

export type FeedWindow = { fromDays: number; toDays: number }

/** The default window: a month back (so a colleague scrolling to last week still sees what happened)
 * and a year forward (an annual plan's milestones are real). Bounded on purpose -- an unbounded feed
 * is how a calendar subscription becomes a slow query. */
export const DEFAULT_WINDOW: FeedWindow = { fromDays: 30, toDays: 365 }

/** Which departments this person is actually in. One query, under their own user GUC --
 * `memberships_read` (migration 0303) allows `user_id = app.current_user_id()`, which is precisely
 * the self-read this needs and nothing wider. */
async function activeDepartmentIds(userId: string): Promise<string[]> {
  const rows = await withContext(
    toRequestContext(systemCtx(userId), { userId }),
    async (tx) =>
      tx.raw<{ department_id: string }>(sql`
        select department_id from app.memberships
        where user_id = ${userId} and status = 'active' and deleted_at is null
        limit 20
      `),
  )
  return rows.map((r) => r.department_id)
}

/**
 * Everything one person's calendar may contain inside one department, as a single union query.
 *
 * What it returns, and deliberately what it does not:
 *   * every event of that department (the department calendar is transparent to its members, exactly
 *     as `/events` already is), carrying this person's own RSVP as the status;
 *   * every active, unarchived card assigned to this person that has a due date;
 *   * nothing from the personal workspace. A private task, note, canvas or Pomodoro session is never
 *     in anybody's calendar feed, including the owner's -- the feed URL is a bearer token that ends
 *     up on a phone, and I-1 does not bend for convenience.
 */
async function departmentItems(
  userId: string,
  departmentId: string,
  from: Date,
  to: Date,
): Promise<CalendarItem[]> {
  const rows = await withContext(
    toRequestContext(systemCtx(userId), {
      userId,
      departmentId,
      // The feed is a read of what this person may see as an ordinary member; nothing in it is
      // head-only, so the lower of the two roles is the honest context.
      departmentRole: 'member',
    }),
    async (tx) =>
      tx.raw<ItemSqlRow>(sql`
        select e.id as item_id,
               'event' as item_kind,
               e.title,
               coalesce(e.description, '') as body,
               e.starts_at,
               e.ends_at,
               coalesce(e.place, '') as place,
               ('/events?event=' || e.id::text) as deep_link,
               case when e.cancelled_at is not null then 'cancelled'
                    else coalesce(r.status::text, 'none') end as status,
               e.updated_at
        from app.events e
        left join app.event_rsvps r on r.event_id = e.id and r.user_id = ${userId}
        where e.deleted_at is null and e.starts_at >= ${from} and e.starts_at < ${to}

        union all

        select c.id as item_id,
               'card' as item_kind,
               c.title,
               '' as body,
               c.due_at as starts_at,
               c.due_at as ends_at,
               '' as place,
               ('/work?card=' || c.id::text) as deep_link,
               c.status::text as status,
               c.updated_at
        from app.cards c
        where c.deleted_at is null
          and c.archived_at is null
          and c.assignee_user_id = ${userId}
          and c.due_at is not null
          and c.due_at >= ${from}
          and c.due_at < ${to}

        order by starts_at asc
        limit 1000
      `),
  )
  return rows.map((r) => ({
    id: r.item_id,
    kind: r.item_kind,
    title: r.title,
    body: r.body,
    startsAt: toDate(r.starts_at),
    endsAt: toDate(r.ends_at),
    place: r.place,
    deepLink: r.deep_link,
    status: r.status,
    updatedAt: toDate(r.updated_at),
  }))
}

export async function feedItems(
  userId: string,
  kind: FeedKind,
  window: FeedWindow = DEFAULT_WINDOW,
): Promise<CalendarItem[]> {
  const from = new Date(Date.now() - window.fromDays * 86_400_000)
  const to = new Date(Date.now() + window.toDays * 86_400_000)
  const departmentIds = await activeDepartmentIds(userId)
  if (departmentIds.length === 0) return []
  const perDepartment = await Promise.all(
    departmentIds.map((departmentId) => departmentItems(userId, departmentId, from, to)),
  )
  return perDepartment
    .flat()
    .filter((item) =>
      kind === 'all' ? true : kind === 'events' ? item.kind === 'event' : item.kind === 'card',
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

/** One item, for the "download .ics" button and for a CalDAV `calendar-multiget`. Reads through the
 * same `security definer` function so the visibility rule ("an event of a department you belong to,
 * a card assigned to you") is stated exactly once -- at the cost of a wider window than a by-id
 * lookup would need. Two years either side covers every event and due date this product creates
 * (`app.events` has no recurrence and a card's `due_at` is a working deadline, not an anniversary). */
export async function feedItem(userId: string, itemId: string): Promise<CalendarItem | null> {
  const items = await feedItems(userId, 'all', { fromDays: 730, toDays: 730 })
  return items.find((i) => i.id === itemId) ?? null
}

export async function userLocale(userId: string): Promise<string | null> {
  const rows = await withContext(
    toRequestContext(systemCtx(userId), { userId }),
    async (tx) =>
      tx.raw<{ locale: string | null }>(sql`
        select locale from app.users where id = ${userId} limit 1
      `),
  )
  return rows[0]?.locale ?? null
}

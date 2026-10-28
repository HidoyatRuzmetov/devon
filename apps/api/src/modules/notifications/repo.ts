// Postgres-backed repo for the notifications module. `@devon/db`'s public API is exactly its own
// `src/index.ts` barrel (that package's own handoff contract: "this is the ONLY module other packages
// may import from") -- and a module's private schema file (MODULE-GUIDE.md "DB: schema") is
// deliberately never added to that barrel's relational schema map. So this file -- living in
// `@devon/api`, a different package -- never imports `packages/db/src/schema/notifications.ts`
// directly; every query here goes through `Tx.raw()` (the same raw-SQL escape hatch `@devon/db`'s own
// `seed/demo.ts` uses for `app.seed_runs`/`app.instance_settings`), parameterized, never string-built.
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import type { AuditCtx } from '../../types.js'
import {
  REASONS,
  type Channel,
  type DigestMode,
  type LocalizedText,
  type Reason,
} from './schemas.js'
import {
  DEPARTMENT_QUIET_DEFAULT,
  type PersonalQuietOverride,
  type QuietWindow,
} from './quiet-hours.js'

export type NotificationRow = {
  id: string
  type: string
  reason: Reason
  subjectType: string
  subjectId: string | null
  departmentId: string | null
  title: LocalizedText
  body: LocalizedText | null
  deepLink: string | null
  eventAt: Date | null
  readAt: Date | null
  archivedAt: Date | null
  snoozedUntil: Date | null
  createdAt: Date
}

export type NewNotification = {
  userId: string
  type: string
  reason: Reason
  subjectType: string
  subjectId?: string | null
  departmentId?: string | null
  title: LocalizedText
  body?: LocalizedText | null
  deepLink?: string | null
  eventAt?: Date | null
  /** Automation recipients must still belong to the department when their inbox row commits. */
  requireActiveDepartmentMembership?: boolean
}

export class NotificationRecipientUnavailableError extends Error {
  constructor() {
    super('action_target_unavailable')
    this.name = 'NotificationRecipientUnavailableError'
  }
}

export type PrefRow = {
  reason: Reason
  channel: Channel
  enabled: boolean
  digestMode: DigestMode
}

export type DepartmentSettingsRow = {
  departmentId: string
  quietStartMinute: number
  quietEndMinute: number
  quietWeekends: boolean
  groupConnectHeadOnly: boolean
}

/** Every write here still needs a real request id / actor for `withContext`'s GUCs and (where a
 * caller passes one) the audit trail -- background callers (the domain-event subscriber, pg-boss
 * jobs) that act "as" a specific user pass a synthesized one via `systemAuditCtx`. */
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

/** For background work acting on behalf of `userId` with no HTTP request behind it (a domain-event
 * handler, a pg-boss job, the Telegram bot resolving an inbound message) -- a fresh request id per
 * call keeps every audit/outbox row individually traceable, exactly like `db/repo.ts`'s own
 * `anonymousCtx()` does for its background paths. */
export function systemAuditCtx(userId: string | null): AuditCtx {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: null,
    actingForUserId: null,
    ip: '',
    userAgent: 'devon-notifications/system',
  }
}

function departmentAuditCtx(): AuditCtx {
  return systemAuditCtx(null)
}

type NotificationSqlRow = {
  id: string
  type: string
  reason: Reason
  subject_type: string
  subject_id: string | null
  department_id: string | null
  title: LocalizedText
  body: LocalizedText | null
  deep_link: string | null
  // `Tx.raw()` is a plain, un-schema'd SQL query -- none of drizzle's own column-level date mapping
  // runs on it, so the node-postgres driver as drizzle configures it (`node-postgres/session.ts`)
  // hands back TIMESTAMPTZ columns as raw strings on this path, never a `Date` (confirmed in the
  // wild: `structure/repo.ts`'s `toUnitRoleDto` threw "assigned_at.toISOString is not a function"
  // from the exact same pattern). Typed as `Date | string` here to match what actually comes back;
  // `fromSqlRow` below normalises to real `Date`s so every caller's `.toISOString()` stays valid.
  event_at: Date | string | null
  read_at: Date | string | null
  archived_at: Date | string | null
  snoozed_until: Date | string | null
  created_at: Date | string
  cursor_created_at?: string
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

function fromSqlRow(r: NotificationSqlRow): NotificationRow {
  return {
    id: r.id,
    type: r.type,
    reason: r.reason,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    departmentId: r.department_id,
    title: r.title,
    body: r.body,
    deepLink: r.deep_link,
    eventAt: r.event_at === null ? null : toDate(r.event_at),
    readAt: r.read_at === null ? null : toDate(r.read_at),
    archivedAt: r.archived_at === null ? null : toDate(r.archived_at),
    snoozedUntil: r.snoozed_until === null ? null : toDate(r.snoozed_until),
    createdAt: toDate(r.created_at),
  }
}

// --- Notifications ----------------------------------------------------------------------------------

export async function insertNotification(
  ctx: AuditCtx,
  input: NewNotification,
): Promise<NotificationRow> {
  return withContext(
    toRequestContext(ctx, {
      userId: input.userId,
      ...(input.requireActiveDepartmentMembership
        ? { departmentId: input.departmentId ?? null }
        : {}),
    }),
    async (tx) => {
      if (input.requireActiveDepartmentMembership) {
        if (!input.departmentId) throw new NotificationRecipientUnavailableError()
        const recipients = await tx.raw<{ id: string }>(sql`
        select m.user_id as id from app.memberships m join app.users u on u.id = m.user_id
        where m.department_id = ${input.departmentId} and m.user_id = ${input.userId}
          and m.status = 'active' and m.deleted_at is null
          and u.status = 'active' and u.deleted_at is null for share of m, u
      `)
        if (!recipients[0]) throw new NotificationRecipientUnavailableError()
      }
      const rows = await tx.raw<NotificationSqlRow & { inapp_visible: boolean }>(sql`
      insert into app.notifications
        (user_id, type, reason, subject_type, subject_id, department_id, title, body, deep_link, event_at, inapp_visible)
      values (${input.userId}, ${input.type}, ${input.reason}, ${input.subjectType},
              ${input.subjectId ?? null}, ${input.departmentId ?? null},
              ${JSON.stringify(input.title)}::jsonb, ${input.body ? JSON.stringify(input.body) : null}::jsonb,
              ${input.deepLink ?? null}, ${input.eventAt ?? null},
              coalesce((select enabled from app.notification_prefs
                where user_id = ${input.userId} and reason = ${input.reason}
                  and channel = 'inapp'), true))
      returning id, type, reason, subject_type, subject_id, department_id, title, body, deep_link,
                event_at, read_at, archived_at, snoozed_until, created_at, inapp_visible
    `)
      const row = rows[0]
      if (!row) throw new Error('notifications: insert returned no row')
      tx.audit({
        action: 'notifications.created',
        subjectType: 'notification',
        subjectId: row.id,
        after: {
          reason: row.reason,
          type: row.type,
          inappVisible: row.inapp_visible,
        },
      })
      tx.emit({
        type: 'notifications.notification.created',
        payload: {
          notificationId: row.id,
          userId: input.userId,
          reason: input.reason,
          inappVisible: row.inapp_visible,
        },
      })
      return fromSqlRow(row)
    },
  )
}

export type ListOpts = {
  status: 'inbox' | 'archived' | 'unread'
  reason?: Reason | undefined
  cursor?: string | undefined
  limit: number
}

export type ListResult = {
  items: NotificationRow[]
  unreadCount: number
  groupCounts: Record<'tasks' | 'events' | 'summaries' | 'system', number>
  nextCursor: string | null
}

export async function listNotifications(userId: string, opts: ListOpts): Promise<ListResult> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const statusClause =
      opts.status === 'archived'
        ? sql`archived_at is not null`
        : opts.status === 'unread'
          ? sql`archived_at is null and read_at is null and (snoozed_until is null or snoozed_until <= now())`
          : sql`archived_at is null and (snoozed_until is null or snoozed_until <= now())`
    const reasonClause = opts.reason ? sql`and reason = ${opts.reason}` : sql``
    const [cursorDate, cursorId] = opts.cursor?.split('|') ?? []
    const cursorClause = cursorDate
      ? cursorId
        ? sql`and (created_at, id) < (${cursorDate}::timestamptz, ${cursorId}::uuid)`
        : sql`and created_at < ${cursorDate}::timestamptz`
      : sql``

    const rows = await tx.raw<NotificationSqlRow>(sql`
      select id, type, reason, subject_type, subject_id, department_id, title, body, deep_link,
             event_at, read_at, archived_at, snoozed_until, created_at,
             to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at
      from app.notifications
      where app.notification_is_visible(id) and ${statusClause} ${reasonClause} ${cursorClause}
      order by created_at desc, id desc
      limit ${opts.limit + 1}
    `)
    const hasMore = rows.length > opts.limit
    const page = hasMore ? rows.slice(0, opts.limit) : rows
    const items = page.map(fromSqlRow)
    const last = page.at(-1)
    const nextCursor =
      hasMore && last
        ? `${last.cursor_created_at ?? toDate(last.created_at).toISOString()}|${last.id}`
        : null

    const unreadRows = await tx.raw<{ n: string }>(sql`
      select count(*)::text as n from app.notifications
      where app.notification_is_visible(id) and archived_at is null and read_at is null
        and (snoozed_until is null or snoozed_until <= now())
    `)
    const unreadCount = Number(unreadRows[0]?.n ?? '0')

    // Count the same authorized, filtered collection before the page cursor. These are totals,
    // not the number already loaded in the browser. Keep category semantics aligned with groups.ts.
    const grouped = await tx.raw<{
      category: 'tasks' | 'events' | 'summaries' | 'system'
      n: string
    }>(sql`
      select case
        when reason = 'digest' then 'summaries'
        when subject_type in ('event', 'rsvp', 'poll', 'event_poll') or reason in ('rsvp', 'poll') then 'events'
        when subject_type in ('card', 'project', 'checklist', 'comment', 'task') or reason in ('assigned', 'due') then 'tasks'
        else 'system' end as category, count(*)::text as n
      from app.notifications
      where app.notification_is_visible(id) and ${statusClause} ${reasonClause}
      group by category
    `)
    const groupCounts = { tasks: 0, events: 0, summaries: 0, system: 0 }
    for (const group of grouped) groupCounts[group.category] = Number(group.n)
    return { items, unreadCount, groupCounts, nextCursor }
  })
}

export async function markRead(ctx: AuditCtx, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    // Drizzle's `sql` template expands an interpolated plain array into a parenthesized value list
    // (`(el1, el2, ...)`), not a single array-typed bind parameter -- `= any($1::uuid[])` here used to
    // bind that parenthesized list as one `record` value and fail to cast to `uuid[]` ("cannot cast
    // type record to uuid[]", confirmed in the wild via the identical bug in `events/repo.ts`). `in`
    // is exactly the clause that expansion is for.
    const rows = await tx.raw<{ id: string }>(sql`
      update app.notifications set read_at = now()
      where id in ${ids} and read_at is null
      returning id
    `)
    if (rows.length > 0)
      tx.audit({
        action: 'notifications.read',
        subjectType: 'notification',
        subjectId: null,
        after: { ids: rows.map((r) => r.id) },
      })
    if (rows.length > 0)
      tx.emit({
        type: 'notifications.notification.updated',
        payload: { userId },
      })
    return rows.length
  })
}

export async function markAllRead(ctx: AuditCtx, userId: string): Promise<number> {
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.notifications set read_at = now()
      where read_at is null and archived_at is null and app.notification_is_visible(id)
      returning id
    `)
    if (rows.length > 0)
      tx.audit({
        action: 'notifications.read_all',
        subjectType: 'notification',
        subjectId: null,
        after: { count: rows.length },
      })
    if (rows.length > 0)
      tx.emit({
        type: 'notifications.notification.updated',
        payload: { userId },
      })
    return rows.length
  })
}

export async function archiveNotifications(
  ctx: AuditCtx,
  userId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.notifications set archived_at = now(), read_at = coalesce(read_at, now())
      where id in ${ids} and archived_at is null
      returning id
    `)
    if (rows.length > 0)
      tx.audit({
        action: 'notifications.archived',
        subjectType: 'notification',
        subjectId: null,
        after: { ids: rows.map((r) => r.id) },
      })
    if (rows.length > 0)
      tx.emit({
        type: 'notifications.notification.updated',
        payload: { userId },
      })
    return rows.length
  })
}

/** Restore an owner's archived inbox item. Read state is retained, as with archive itself. */
export async function restoreNotifications(
  ctx: AuditCtx,
  userId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.notifications set archived_at = null
      where id in ${ids} and archived_at is not null
      returning id
    `)
    if (rows.length > 0) {
      tx.audit({
        action: 'notifications.restored',
        subjectType: 'notification',
        subjectId: null,
        after: { ids: rows.map((r) => r.id) },
      })
      tx.emit({
        type: 'notifications.notification.updated',
        payload: { userId },
      })
    }
    return rows.length
  })
}

export async function getNotificationById(
  userId: string,
  id: string,
): Promise<NotificationRow | null> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<NotificationSqlRow>(sql`
      select id, type, reason, subject_type, subject_id, department_id, title, body, deep_link,
             event_at, read_at, archived_at, snoozed_until, created_at
      from app.notifications where id = ${id} and app.notification_subject_is_visible(id)
    `)
    const row = rows[0]
    return row ? fromSqlRow(row) : null
  })
}

export async function snoozeNotification(
  ctx: AuditCtx,
  userId: string,
  id: string,
  until: Date,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.notifications set snoozed_until = ${until}
      where id = ${id}
      returning id
    `)
    if (rows.length > 0)
      tx.audit({
        action: 'notifications.snoozed',
        subjectType: 'notification',
        subjectId: id,
        after: { until: until.toISOString() },
      })
    return rows.length > 0
  })
}

// --- Preferences -------------------------------------------------------------------------------------

const CHANNELS: Channel[] = ['inapp', 'telegram', 'email']

/** Default (`enabled`, `digestMode`) for a (reason, channel) pair that has no stored row yet -- inapp
 * starts enabled; telegram/email default off
 * until the person opts in, except `due`/`digest`/`system`, which default on once a channel is linked
 * (the same defaults the demo seed writes for its own accounts). */
function defaultPref(
  reason: Reason,
  channel: Channel,
): { enabled: boolean; digestMode: DigestMode } {
  if (channel === 'inapp') return { enabled: true, digestMode: 'instant' }
  const onByDefault: Reason[] = ['due', 'digest', 'system']
  return {
    enabled: onByDefault.includes(reason),
    digestMode: reason === 'digest' ? 'daily' : 'instant',
  }
}

export async function getPrefs(userId: string): Promise<PrefRow[]> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{
      reason: Reason
      channel: Channel
      enabled: boolean
      digest_mode: DigestMode
    }>(sql`
      select reason, channel, enabled, digest_mode from app.notification_prefs
    `)
    const byKey = new Map(rows.map((r) => [`${r.reason}:${r.channel}`, r]))
    const out: PrefRow[] = []
    for (const reason of REASONS) {
      for (const channel of CHANNELS) {
        const stored = byKey.get(`${reason}:${channel}`)
        if (channel === 'inapp')
          out.push({
            reason,
            channel,
            enabled: stored?.enabled ?? true,
            digestMode: 'instant',
          })
        else if (stored)
          out.push({
            reason,
            channel,
            enabled: stored.enabled,
            digestMode:
              channel === 'telegram' && reason === 'digest' && stored.digest_mode === 'instant'
                ? 'daily'
                : stored.digest_mode,
          })
        else out.push({ reason, channel, ...defaultPref(reason, channel) })
      }
    }
    return out
  })
}

export async function putPrefs(
  ctx: AuditCtx,
  userId: string,
  items: {
    reason: Reason
    channel: Channel
    enabled: boolean
    digestMode?: DigestMode | undefined
  }[],
): Promise<PrefRow[]> {
  await withContext(toRequestContext(ctx, { userId }), async (tx) => {
    if (items.length > 0) {
      // H3.1/H3.2: one multi-row upsert (a VALUES list joined against the target table -- the same
      // shape `pages/onboarding.ts` and `personal/repo.ts`'s `reorderTasks` already use for a batch)
      // instead of one `insert ... on conflict` per item.
      const valueRows = items.map((item) => {
        const digestMode = item.digestMode ?? defaultPref(item.reason, item.channel).digestMode
        return sql`(${userId}::uuid, ${item.reason}::app.notification_reason, ${item.channel}::app.notification_channel, ${item.enabled}::boolean, ${digestMode}::app.notification_digest_mode)`
      })
      await tx.raw(sql`
        insert into app.notification_prefs (user_id, reason, channel, enabled, digest_mode)
        select * from (values ${sql.join(valueRows, sql.raw(', '))})
          as v(user_id, reason, channel, enabled, digest_mode)
        on conflict (user_id, reason, channel)
        do update set enabled = excluded.enabled, digest_mode = excluded.digest_mode, updated_at = now()
      `)
    }
    tx.audit({
      action: 'notifications.prefs_updated',
      subjectType: 'notification_prefs',
      subjectId: userId,
      after: { count: items.length },
    })
  })
  return getPrefs(userId)
}

// --- Quiet hours -------------------------------------------------------------------------------------

export async function getPersonalQuietHours(userId: string): Promise<PersonalQuietOverride | null> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{
      start_minute: number | null
      end_minute: number | null
      include_weekends: boolean | null
    }>(sql`
      select start_minute, end_minute, include_weekends from app.notification_quiet_hours where user_id = ${userId}
    `)
    const row = rows[0]
    if (!row) return null
    return {
      startMinute: row.start_minute,
      endMinute: row.end_minute,
      includeWeekends: row.include_weekends,
    }
  })
}

export async function putPersonalQuietHours(
  ctx: AuditCtx,
  userId: string,
  patch: PersonalQuietOverride,
): Promise<void> {
  await withContext(toRequestContext(ctx, { userId }), async (tx) => {
    await tx.raw(sql`
      insert into app.notification_quiet_hours (user_id, start_minute, end_minute, include_weekends)
      values (${userId}, ${patch.startMinute}, ${patch.endMinute}, ${patch.includeWeekends})
      on conflict (user_id)
      do update set start_minute = excluded.start_minute, end_minute = excluded.end_minute,
                    include_weekends = excluded.include_weekends, updated_at = now()
    `)
    tx.audit({
      action: 'notifications.quiet_hours_updated',
      subjectType: 'notification_quiet_hours',
      subjectId: userId,
      after: patch,
    })
  })
}

export async function getDepartmentQuietDefault(departmentId: string): Promise<QuietWindow> {
  const settings = await getDepartmentSettings(departmentId)
  return {
    startMinute: settings.quietStartMinute,
    endMinute: settings.quietEndMinute,
    includeWeekends: settings.quietWeekends,
  }
}

// --- Department settings -----------------------------------------------------------------------------

export async function getDepartmentSettings(departmentId: string): Promise<DepartmentSettingsRow> {
  return withContext(
    toRequestContext(departmentAuditCtx(), {
      departmentId,
      actorRole: 'super_admin',
    }),
    async (tx) => {
      const rows = await tx.raw<{
        department_id: string
        quiet_start_minute: number
        quiet_end_minute: number
        quiet_weekends: boolean
        group_connect_head_only: boolean
      }>(sql`
      select department_id, quiet_start_minute, quiet_end_minute, quiet_weekends, group_connect_head_only
      from app.notification_department_settings where department_id = ${departmentId}
    `)
      const row = rows[0]
      if (!row) {
        return {
          departmentId,
          quietStartMinute: DEPARTMENT_QUIET_DEFAULT.startMinute,
          quietEndMinute: DEPARTMENT_QUIET_DEFAULT.endMinute,
          quietWeekends: DEPARTMENT_QUIET_DEFAULT.includeWeekends,
          groupConnectHeadOnly: true,
        }
      }
      return {
        departmentId: row.department_id,
        quietStartMinute: row.quiet_start_minute,
        quietEndMinute: row.quiet_end_minute,
        quietWeekends: row.quiet_weekends,
        groupConnectHeadOnly: row.group_connect_head_only,
      }
    },
  )
}

export async function putDepartmentSettings(
  ctx: AuditCtx,
  departmentId: string,
  patch: {
    quietStartMinute?: number | undefined
    quietEndMinute?: number | undefined
    quietWeekends?: boolean | undefined
    groupConnectHeadOnly?: boolean | undefined
  },
): Promise<DepartmentSettingsRow> {
  const current = await getDepartmentSettings(departmentId)
  const next: DepartmentSettingsRow = {
    departmentId,
    quietStartMinute: patch.quietStartMinute ?? current.quietStartMinute,
    quietEndMinute: patch.quietEndMinute ?? current.quietEndMinute,
    quietWeekends: patch.quietWeekends ?? current.quietWeekends,
    groupConnectHeadOnly: patch.groupConnectHeadOnly ?? current.groupConnectHeadOnly,
  }
  await withContext(toRequestContext(ctx, { departmentId, actorRole: 'head' }), async (tx) => {
    await tx.raw(sql`
      insert into app.notification_department_settings
        (department_id, quiet_start_minute, quiet_end_minute, quiet_weekends, group_connect_head_only)
      values (${departmentId}, ${next.quietStartMinute}, ${next.quietEndMinute}, ${next.quietWeekends}, ${next.groupConnectHeadOnly})
      on conflict (department_id)
      do update set quiet_start_minute = excluded.quiet_start_minute, quiet_end_minute = excluded.quiet_end_minute,
                    quiet_weekends = excluded.quiet_weekends, group_connect_head_only = excluded.group_connect_head_only,
                    updated_at = now()
    `)
    tx.audit({
      action: 'notifications.department_settings_updated',
      subjectType: 'notification_department_settings',
      subjectId: departmentId,
      after: next,
    })
  })
  return next
}

// --- Jobs: reminders and digests ---------------------------------------------------------------------

/** Unread `due` notifications this user has never had a *sent* Telegram delivery for -- the hourly
 * `reminder.due` job's retry surface (a first attempt skipped for quiet hours, or made before the
 * person had linked Telegram, gets a second chance here without ever double-sending one that already
 * went out). */
export async function listDueNotificationsNeedingTelegram(
  userId: string,
): Promise<NotificationRow[]> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<NotificationSqlRow>(sql`
      select n.id, n.type, n.reason, n.subject_type, n.subject_id, n.department_id, n.title, n.body,
             n.deep_link, n.event_at, n.read_at, n.archived_at, n.snoozed_until, n.created_at
      from app.notifications n
      where app.notification_subject_is_visible(n.id) and n.reason = 'due' and n.read_at is null and n.archived_at is null
        and (n.snoozed_until is null or n.snoozed_until <= now())
        and not exists (
          select 1 from app.notification_deliveries d
          where d.notification_id = n.id and d.channel = 'telegram' and d.status = 'sent'
        )
      order by n.created_at asc
      limit 50
    `)
    return rows.map(fromSqlRow)
  })
}

export type ReasonCounts = Partial<Record<Reason, number>>

export async function unreadCountsByReason(userId: string): Promise<ReasonCounts> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{ reason: Reason; n: string }>(sql`
      select reason, count(*)::text as n from app.notifications
      where app.notification_subject_is_visible(id) and read_at is null and archived_at is null and (snoozed_until is null or snoozed_until <= now())
        and subject_type <> 'digest'
      group by reason
    `)
    const out: ReasonCounts = {}
    for (const r of rows) out[r.reason] = Number(r.n)
    return out
  })
}

export async function countsByReasonSince(
  userId: string,
  since: Date,
  departmentId?: string,
): Promise<ReasonCounts> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{ reason: Reason; n: string }>(sql`
      select reason, count(*)::text as n from app.notifications
      where app.notification_subject_is_visible(id) and created_at >= ${since}
        and subject_type <> 'digest'
        ${departmentId ? sql`and department_id = ${departmentId}` : sql``}
      group by reason
    `)
    const out: ReasonCounts = {}
    for (const r of rows) out[r.reason] = Number(r.n)
    return out
  })
}

// --- Deliveries --------------------------------------------------------------------------------------

export async function recordDelivery(
  ctx: AuditCtx,
  input: {
    userId: string
    notificationId: string
    channel: Channel
    status: 'sent' | 'failed' | 'skipped'
    providerId?: string | null
    error?: string | null
  },
): Promise<void> {
  await withContext(toRequestContext(ctx, { userId: input.userId }), async (tx) => {
    await tx.raw(sql`
      insert into app.notification_deliveries (user_id, notification_id, channel, status, provider_id, error, sent_at, attempts)
      values (${input.userId}, ${input.notificationId}, ${input.channel}, ${input.status},
              ${input.providerId ?? null}, ${input.error ?? null}, ${input.status === 'sent' ? sql`now()` : null}, 1)
    `)
  })
}

// --- ICS feed source data ---------------------------------------------------------------------------

export type IcsItem = {
  id: string
  title: LocalizedText
  deepLink: string | null
  eventAt: Date
}

export async function listUpcomingForIcs(userId: string, fromDaysAgo = 7): Promise<IcsItem[]> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{
      id: string
      title: LocalizedText
      deep_link: string | null
      event_at: Date | string
    }>(sql`
      select id, title, deep_link, event_at from app.notifications
      where app.notification_subject_is_visible(id) and event_at is not null and event_at >= now() - (${fromDaysAgo} || ' days')::interval
      order by event_at asc
      limit 200
    `)
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      deepLink: r.deep_link,
      eventAt: toDate(r.event_at),
    }))
  })
}

// --- Broadcast (event handler / jobs): resolving every active member of a department ----------------

export async function listActiveMemberUserIds(departmentId: string): Promise<string[]> {
  return withContext(
    toRequestContext(departmentAuditCtx(), {
      departmentId,
      actorRole: 'super_admin',
    }),
    async (tx) => {
      const rows = await tx.raw<{ user_id: string }>(sql`
      select user_id from app.memberships where department_id = ${departmentId} and status = 'active'
    `)
      return rows.map((r) => r.user_id)
    },
  )
}

/** All departments with at least one active membership -- used by the digest job to know which
 * departments to iterate one at a time (memberships carries no super-admin RLS bypass, I-1's sibling
 * rule for department_owned tables with a role check baked in only where the design wants one, so
 * this reads `app.departments` -- whose read policy *does* allow `current_actor_role() = 'super_admin'`
 * -- and visits each department's own context afterwards). */
export async function listAllDepartmentIds(): Promise<string[]> {
  return withContext(
    toRequestContext(departmentAuditCtx(), { actorRole: 'super_admin' }),
    async (tx) => {
      const rows = await tx.raw<{ id: string }>(
        sql`select id from app.departments where deleted_at is null and status = 'active'`,
      )
      return rows.map((r) => r.id)
    },
  )
}

/**
 * Blitz integration fix (TECH-SPEC §11, pause/wipe): instance-wide maintenance mode blocks every
 * ordinary request (`apps/web`'s app-wide maintenance screen, `apps/api`'s 503 for everyone but the
 * super admin console), but nothing stopped a pg-boss job from still running underneath it -- a
 * digest/reminder cron firing mid-maintenance would deliver Telegram messages while the product itself
 * tells everyone it is down, and a paused department is already excluded from `listAllDepartmentIds`
 * above (its own `status = 'active'` filter) but the instance-wide switch was never checked at all.
 * Same query shape `apps/api/src/db/repo.ts`'s `getInstanceSettings` uses, duplicated here rather than
 * imported -- MODULE-GUIDE.md: a module's repo code goes through `@devon/db`'s `withContext()`
 * directly, never through another module's `Deps`. `app.instance_settings` is a single-row,
 * non-tenant, non-RLS table (no `department_id`), so the same `departmentAuditCtx()` background
 * context every other query on this page already uses reads it fine. */
export async function isMaintenanceActive(): Promise<boolean> {
  return withContext(toRequestContext(departmentAuditCtx()), async (tx) => {
    const rows = await tx.raw<{ maintenance: { enabled?: boolean } | null }>(
      sql`select maintenance from app.instance_settings where id = 1`,
    )
    return rows[0]?.maintenance?.enabled === true
  })
}

/**
 * Emitted for a Telegram inline-button action this module cannot itself fulfil (RSVP, poll vote --
 * TECH-SPEC §7's "inline buttons for RSVP, poll vote, mark done, snooze") because the subject row
 * belongs to a module this one has no schema access to (MODULE-GUIDE.md: "there is no shared
 * payload-types package, and there never should be"). The owning module, once it exists, subscribes to
 * `notifications.action.requested` the same way this module subscribes to everyone else's events
 * (`events.ts`). "Mark done" and "snooze" are handled locally instead (`markRead`/`snoozeNotification`)
 * because they only ever mutate this module's own row.
 */
export async function emitActionRequested(
  actorUserId: string,
  action: 'rsvp_yes' | 'rsvp_no' | 'rsvp_maybe' | 'poll_vote',
  subjectType: string,
  subjectId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await withContext(
    toRequestContext(systemAuditCtx(actorUserId), { userId: actorUserId }),
    async (tx) => {
      tx.emit({
        type: 'notifications.action.requested',
        payload: { actorUserId, action, subjectType, subjectId, ...extra },
      })
      tx.audit({
        action: 'notifications.action_requested',
        subjectType,
        subjectId,
        after: { action },
      })
    },
  )
}

export type { Tx }

/** Reconcile against current persisted state so delayed revisions cannot revive stale mentions.
 * Retained recipients keep their unread state and receive the corrected excerpt; removed recipients
 * lose the outdated inbox entry. Sent Telegram messages remain delivery history. */
export async function reconcileCommentNotifications(
  departmentId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (
    !departmentId ||
    typeof payload['cardId'] !== 'string' ||
    typeof payload['commentId'] !== 'string'
  )
    return
  const recipients = Array.isArray(payload['recipientIds'])
    ? payload['recipientIds'].filter((id): id is string => typeof id === 'string')
    : []
  const link = `/work/card?id=${payload['cardId']}#comment-${payload['commentId']}`
  const current = await withContext(
    toRequestContext(departmentAuditCtx(), {
      departmentId,
      actorRole: 'super_admin',
    }),
    async (tx) => {
      const rows = await tx.raw<{
        text: string | null
        mentions: string[]
        watchers: string[]
        assignee_user_id: string | null
        giver_user_id: string | null
      }>(sql`select comment.body->>'text' as text,comment.mentions,card.watchers,
        card.assignee_user_id,card.giver_user_id
        from app.card_comments comment join app.cards card on card.id=comment.card_id
        where comment.id=${payload['commentId']} and comment.card_id=${payload['cardId']}
          and comment.department_id=${departmentId} and card.department_id=${departmentId}
          and comment.deleted_at is null and card.deleted_at is null`)
      return rows[0]
    },
  )
  const retained = new Set(
    current
      ? [...current.mentions, ...current.watchers, current.assignee_user_id, current.giver_user_id]
      : [],
  )
  const excerpt = current?.text?.slice(0, 240) ?? ''
  const revisedBody = JSON.stringify({
    en: excerpt,
    ru: excerpt,
    'uz-Latn': excerpt,
    'uz-Cyrl': excerpt,
  })
  await Promise.all(
    [...new Set(recipients)].map((userId) =>
      withContext(toRequestContext(systemAuditCtx(userId)), async (tx) => {
        if (retained.has(userId))
          await tx.raw(sql`update app.notifications set body=${revisedBody}::jsonb
          where user_id=${userId} and department_id=${departmentId} and type='work.card.commented' and deep_link=${link}`)
        else
          await tx.raw(sql`update app.notifications set read_at=coalesce(read_at,now()),archived_at=coalesce(archived_at,now())
          where user_id=${userId} and department_id=${departmentId} and type='work.card.commented' and deep_link=${link}`)
        tx.emit({
          type: 'notifications.notification.updated',
          payload: { userId },
          departmentId,
        })
      }),
    ),
  )
}

/** Resolve the current message before handling an edit event: delayed outbox delivery must never
 * resurrect a removed mention or a deleted comment. Already-delivered Telegram pings cannot be recalled. */
export async function reconcileProjectCommentNotifications(
  departmentId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (
    !departmentId ||
    typeof payload['projectId'] !== 'string' ||
    typeof payload['commentId'] !== 'string'
  )
    return
  const recipients = Array.isArray(payload['recipientIds'])
    ? payload['recipientIds'].filter((id): id is string => typeof id === 'string')
    : []
  const link = `/projects/view?id=${payload['projectId']}&tab=discussion#comment-${payload['commentId']}`
  const current = await withContext(
    toRequestContext(departmentAuditCtx(), { departmentId, actorRole: 'super_admin' }),
    async (tx) => {
      const [row] = await tx.raw<{
        text: string
        mentions: string[]
        members: string[]
        owner_user_id: string
      }>(sql`select c.body->>'text' as text,c.mentions,p.members,p.owner_user_id
      from app.project_comments c join app.projects p on p.id=c.project_id
      where c.id=${payload['commentId']} and p.id=${payload['projectId']} and c.department_id=${departmentId} and p.department_id=${departmentId}
      and c.deleted_at is null and p.deleted_at is null`)
      return row
    },
  )
  const retained = new Set(
    current ? [...current.mentions, ...current.members, current.owner_user_id] : [],
  )
  const excerpt = current?.text.slice(0, 240) ?? ''
  const body = JSON.stringify({ en: excerpt, ru: excerpt, 'uz-Latn': excerpt, 'uz-Cyrl': excerpt })
  await Promise.all(
    [...new Set(recipients)].map((userId) =>
      withContext(toRequestContext(systemAuditCtx(userId)), async (tx) => {
        if (retained.has(userId))
          await tx.raw(
            sql`update app.notifications set body=${body}::jsonb where user_id=${userId} and department_id=${departmentId} and type='projects.project.commented' and deep_link=${link}`,
          )
        else
          await tx.raw(
            sql`update app.notifications set read_at=coalesce(read_at,now()),archived_at=coalesce(archived_at,now()) where user_id=${userId} and department_id=${departmentId} and type='projects.project.commented' and deep_link=${link}`,
          )
        tx.emit({ type: 'notifications.notification.updated', payload: { userId }, departmentId })
      }),
    ),
  )
}

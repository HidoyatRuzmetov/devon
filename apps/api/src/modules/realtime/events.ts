// The bridge from the outbox to the browser (v1.1 SPEC §10: "live updates of card moves and inbox
// counts, replacing polling").
//
// One `subscribe('*')` handler, the same shape the notifications module uses, because the outbox is
// the only place that knows a write actually committed (`Tx.emit` flushes inside the writing
// transaction -- MODULE-GUIDE.md "Domain events"). A realtime publication derived from anything
// earlier would be a lie the client could observe before the row existed.
//
// Two destinations:
//   * every department-scoped event goes to `dept:<departmentId>` as `{type, payload}` -- the client
//     turns that into a React Query invalidation, which is why the polling intervals can go;
//   * `notifications.notification.created` goes to that one person's `personal#<userId>` channel and,
//     when they have opted in on a browser and it is not their quiet hours, to Web Push.
//
// What a publication may carry: identifiers, counts and the actor. Never a title, never a comment
// body, never a person's field value. A channel has many subscribers and `can()` was answered once,
// for the channel, not per payload -- so the payload has to be uninteresting by construction and the
// client re-fetches through the ordinary authorised endpoint. `projectPayload` below enforces that
// rather than trusting each emitting module to have been careful.
import type { FastifyBaseLogger } from 'fastify'
import { sql } from 'drizzle-orm'
import { subscribe, withContext, type OutboxEventRecord } from '@devon/db'
import {
  DEPARTMENT_QUIET_DEFAULT,
  isWithinQuietHours,
  resolveEffectiveQuietWindow,
} from '../notifications/quiet-hours.js'
import { departmentChannel, personalChannel } from './channels.js'
import { broadcast, publish } from './publisher.js'
import { sendPushToUser } from './push.js'
import { systemAuditCtx } from './repo.js'

/** Reasons worth a phone buzzing (SPEC §10: "reminders and mentions"). Everything else still lands
 * in the inbox and on the live channel; it just does not interrupt anybody. */
const PUSHABLE_REASONS = new Set(['mentioned', 'due', 'assigned', 'decision'])

/** Keys a department-wide publication may carry: identifiers, the actor, and the list of field names
 * that changed. Anything else -- a title, a body, a name -- is dropped here, once, for every module. */
function projectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const isIdKey = /Id$|Ids$|^id$/.test(key)
    if (isIdKey && (typeof value === 'string' || value === null)) {
      out[key] = value
      continue
    }
    if (isIdKey && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      out[key] = value
      continue
    }
    if (key === 'changes' && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      out[key] = value
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

type NotificationPushRow = {
  reason: string
  title: Record<string, string>
  body: Record<string, string> | null
  deep_link: string | null
  subject_type: string
  subject_id: string | null
  department_id: string | null
  unread_count: number
}

/**
 * Reads the one notification row that was just created, plus this person's current unread count, in
 * ONE statement under their own RLS context (I-14, I-1: the row is `user_owned`, so the policy itself
 * proves we are reading the right person's inbox).
 *
 * `app.notifications` belongs to the notifications module. This module reads it rather than
 * re-deriving a notification's text from the original domain event, because that text -- four
 * locales, the reason-first phrasing DESIGN.md §5 requires -- is exactly what that module's registry
 * already produced. Duplicating it here to keep the tables disjoint would mean two sources of truth
 * for what a person is told, which is worse than one read.
 */
async function loadNotificationForDelivery(
  userId: string,
  notificationId: string,
): Promise<NotificationPushRow | null> {
  return withContext(
    {
      requestId: systemAuditCtx(userId).requestId,
      userId,
      actorRole: null,
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'devon-realtime/system',
    },
    async (tx) => {
      const rows = await tx.raw<NotificationPushRow>(sql`
        select n.reason::text as reason, n.title, n.body, n.deep_link, n.subject_type, n.subject_id,
               n.department_id,
               (select count(*)::int from app.notifications u
                 where u.read_at is null and u.archived_at is null) as unread_count
        from app.notifications n
        where n.id = ${notificationId}
        limit 1
      `)
      return rows[0] ?? null
    },
  )
}

type QuietRow = {
  start_minute: number | null
  end_minute: number | null
  include_weekends: boolean | null
  dept_start_minute: number | null
  dept_end_minute: number | null
  dept_weekends: boolean | null
}

/** The person's effective quiet window, personal override and department default resolved in one
 * statement. Reuses `notifications/quiet-hours.ts`'s pure math rather than restating the rule (I-7:
 * one implementation of a rule, wherever it is consumed). */
async function isQuietFor(userId: string, departmentId: string | null): Promise<boolean> {
  const rows = await withContext(
    {
      requestId: systemAuditCtx(userId).requestId,
      userId,
      actorRole: null,
      departmentId,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'devon-realtime/system',
    },
    async (tx) =>
      tx.raw<QuietRow>(sql`
        select q.start_minute, q.end_minute, q.include_weekends,
               d.quiet_start_minute as dept_start_minute,
               d.quiet_end_minute as dept_end_minute,
               d.quiet_weekends as dept_weekends
        from (select 1 as anchor_row) as anchor
        left join app.notification_quiet_hours q on q.user_id = ${userId}
        left join app.notification_department_settings d
          on d.department_id = ${departmentId}::uuid
        limit 1
      `),
  )
  const row = rows[0]
  const departmentDefault =
    row && row.dept_start_minute !== null && row.dept_end_minute !== null
      ? {
          startMinute: row.dept_start_minute,
          endMinute: row.dept_end_minute,
          includeWeekends: row.dept_weekends ?? true,
        }
      : DEPARTMENT_QUIET_DEFAULT
  const effective = resolveEffectiveQuietWindow(
    row
      ? {
          startMinute: row.start_minute,
          endMinute: row.end_minute,
          includeWeekends: row.include_weekends,
        }
      : null,
    departmentDefault,
  )
  // Asia/Tashkent, like every other time this product shows or decides on (DESIGN.md §5).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const isWeekend = weekday === 'Sat' || weekday === 'Sun'
  return isWithinQuietHours(hour * 60 + minute, isWeekend, effective)
}

type LocaleKey = 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'

function pickLocale(text: Record<string, string> | null, locale: string | null): string {
  if (!text) return ''
  const key = (locale ?? 'uz-Latn') as LocaleKey
  return text[key] ?? text['uz-Latn'] ?? Object.values(text)[0] ?? ''
}

async function handleNotificationCreated(
  log: FastifyBaseLogger,
  payload: Record<string, unknown>,
  publicUrl: string,
): Promise<void> {
  const userId = typeof payload['userId'] === 'string' ? payload['userId'] : null
  const notificationId =
    typeof payload['notificationId'] === 'string' ? payload['notificationId'] : null
  if (!userId || !notificationId) return

  const row = await loadNotificationForDelivery(userId, notificationId)
  if (!row) return

  // The inbox badge and list, live -- this is what replaces the 60-second poll.
  await publish(personalChannel(userId), {
    type: 'inbox.notification.created',
    payload: {
      notificationId,
      reason: row.reason,
      unreadCount: row.unread_count,
      deepLink: row.deep_link,
    },
  })

  if (!PUSHABLE_REASONS.has(row.reason)) return
  if (await isQuietFor(userId, row.department_id)) {
    log.debug({ userId, reason: row.reason }, 'realtime: push suppressed by quiet hours')
    return
  }

  const locale = await loadUserLocale(userId)
  const result = await sendPushToUser(
    userId,
    {
      title: pickLocale(row.title, locale),
      body: pickLocale(row.body, locale),
      deepLink: row.deep_link ?? '/inbox',
      tag: `${row.subject_type}:${row.subject_id ?? notificationId}`,
      reason: row.reason,
    },
    publicUrl,
  )
  if (result.sent > 0) log.debug({ userId, sent: result.sent }, 'realtime: web push delivered')
}

async function loadUserLocale(userId: string): Promise<string | null> {
  const rows = await withContext(
    {
      requestId: systemAuditCtx(userId).requestId,
      userId,
      actorRole: null,
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'devon-realtime/system',
    },
    async (tx) => tx.raw<{ locale: string | null }>(sql`
      select locale from app.users where id = ${userId} limit 1
    `),
  )
  return rows[0]?.locale ?? null
}

let registered = false

/**
 * Subscribes once, at module registration. Every handler swallows its own failure: a Centrifugo that
 * is down, or a push service that 500s, must never make the outbox worker retry a row five times and
 * then abandon it -- the row's *real* consumer is the notifications module, and this one is an
 * enhancement riding along behind it.
 */
export function registerRealtimeEventSubscriptions(
  log: FastifyBaseLogger,
  publicUrl: string,
): void {
  if (registered) return
  registered = true

  subscribe('*', async (event: OutboxEventRecord) => {
    try {
      if (event.type === 'notifications.notification.created') {
        await handleNotificationCreated(
          log,
          (event.payload ?? {}) as Record<string, unknown>,
          publicUrl,
        )
        return
      }

      if (!event.departmentId) return
      const projected = projectPayload(event.payload)
      const actorUserId =
        typeof projected['actorUserId'] === 'string' ? projected['actorUserId'] : null
      await broadcast([departmentChannel(event.departmentId)], {
        type: event.type,
        payload: projected,
        actorUserId,
      })
    } catch (err) {
      log.debug(
        { err: err instanceof Error ? err.message : String(err), eventType: event.type },
        'realtime: live delivery failed (the write itself is committed)',
      )
    }
  })
}

/** Test-only: allow a second registration in a fresh module graph. */
export function __resetRealtimeSubscriptionsForTests(): void {
  registered = false
}

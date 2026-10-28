// Postgres for the realtime module: shared canvases (the only way a personal canvas is ever visible
// to a colleague) and web-push subscriptions. Same shape as every other module's repo -- `Tx.raw()`
// with parameterised SQL through `@devon/db`'s public barrel, never a direct schema import, never a
// string-built query (MODULE-GUIDE.md "DB: schema").
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { AuditCtx } from '../../types.js'

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
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

export function systemAuditCtx(userId: string | null): AuditCtx {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: null,
    actingForUserId: null,
    ip: '',
    userAgent: 'devon-realtime/system',
  }
}

// --- Web push subscriptions -----------------------------------------------------------------------

export type PushSubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  authSecret: string
  browserLabel: string
  locale: string | null
  createdAt: Date
  lastSeenAt: Date
  failureCount: number
}

type PushSqlRow = {
  id: string
  endpoint: string
  p256dh: string
  auth_secret: string
  browser_label: string
  locale: string | null
  created_at: Date | string
  last_seen_at: Date | string
  failure_count: number
}

function toPush(r: PushSqlRow): PushSubscriptionRow {
  return {
    id: r.id,
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    authSecret: r.auth_secret,
    browserLabel: r.browser_label,
    locale: r.locale,
    createdAt: toDate(r.created_at),
    lastSeenAt: toDate(r.last_seen_at),
    failureCount: r.failure_count,
  }
}

export async function upsertPushSubscription(
  ctx: AuditCtx,
  input: {
    userId: string
    endpoint: string
    p256dh: string
    authSecret: string
    browserLabel: string
    locale: string | null
  },
): Promise<PushSubscriptionRow> {
  return withContext(toRequestContext(ctx, { userId: input.userId }), async (tx) => {
    const rows = await tx.raw<PushSqlRow>(sql`
      insert into app.push_subscriptions
        (user_id, endpoint, p256dh, auth_secret, browser_label, locale)
      values (${input.userId}, ${input.endpoint}, ${input.p256dh}, ${input.authSecret},
              ${input.browserLabel}, ${input.locale})
      on conflict (endpoint) do update
        set p256dh = excluded.p256dh,
            auth_secret = excluded.auth_secret,
            browser_label = excluded.browser_label,
            locale = excluded.locale,
            last_seen_at = now(),
            failure_count = 0,
            disabled_at = null
      returning id, endpoint, p256dh, auth_secret, browser_label, locale, created_at, last_seen_at,
                failure_count
    `)
    const row = rows[0]
    if (!row) throw new Error('realtime: push subscription upsert returned no row')
    tx.audit({
      action: 'push.subscription_added',
      subjectType: 'push_subscription',
      subjectId: row.id,
      // The endpoint is a per-browser capability URL issued by the push service -- a credential, not
      // a fact worth keeping in an audit row. Only the browser label the person themselves chose.
      after: { browserLabel: row.browser_label },
    })
    tx.emit({
      type: 'push.subscription.created',
      payload: { subscriptionId: row.id, userId: input.userId },
    })
    return toPush(row)
  })
}

export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<PushSqlRow>(sql`
      select id, endpoint, p256dh, auth_secret, browser_label, locale, created_at, last_seen_at,
             failure_count
      from app.push_subscriptions
      where disabled_at is null
      order by created_at asc
      limit 20
    `)
    return rows.map(toPush)
  })
}

export async function deletePushSubscription(
  ctx: AuditCtx,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  return withContext(toRequestContext(ctx, { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.push_subscriptions
      set disabled_at = now()
      where endpoint = ${endpoint} and disabled_at is null
      returning id
    `)
    const row = rows[0]
    if (!row) return false
    tx.audit({
      action: 'push.subscription_removed',
      subjectType: 'push_subscription',
      subjectId: row.id,
    })
    tx.emit({ type: 'push.subscription.removed', payload: { subscriptionId: row.id, userId } })
    return true
  })
}

/** A push service answering 404/410 means that browser's subscription is gone for good; anything
 * else transient is counted and the subscription is retired after five consecutive failures, so a
 * dead endpoint cannot be retried for ever (H11.1: bounded work). */
export async function markPushFailure(
  userId: string,
  endpoint: string,
  permanent: boolean,
): Promise<void> {
  await withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    await tx.raw(sql`
      update app.push_subscriptions
      set failure_count = failure_count + 1,
          disabled_at = case
            when ${permanent} then now()
            when failure_count + 1 >= 5 then now()
            else disabled_at
          end
      where endpoint = ${endpoint}
    `)
  })
}

export async function markPushSent(userId: string, endpoints: readonly string[]): Promise<void> {
  if (endpoints.length === 0) return
  await withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    await tx.raw(sql`
      update app.push_subscriptions
      set last_sent_at = now(), failure_count = 0
      where endpoint = any (${[...endpoints]}::text[])
    `)
  })
}

// --- VAPID keypair (instance-wide) ----------------------------------------------------------------

export type VapidKeypair = { publicKey: string; privateKey: string }

export async function loadVapidKeys(): Promise<VapidKeypair | null> {
  return withContext(
    toRequestContext(systemAuditCtx(null), { actorRole: 'super_admin' }),
    async (tx) => {
      const rows = await tx.raw<{ public_key: string; private_key: string }>(sql`
        select public_key, private_key from app.push_vapid_keys where id = 'default' limit 1
      `)
      const row = rows[0]
      return row ? { publicKey: row.public_key, privateKey: row.private_key } : null
    },
  )
}

/** First writer wins: two API instances booting at once both generate a keypair, and exactly one of
 * them is kept -- rotating the VAPID identity silently unsubscribes every browser, so the insert is
 * `on conflict do nothing` and the winner is read back. */
export async function saveVapidKeys(keys: VapidKeypair): Promise<VapidKeypair> {
  return withContext(
    toRequestContext(systemAuditCtx(null), { actorRole: 'super_admin' }),
    async (tx) => {
      await tx.raw(sql`
        insert into app.push_vapid_keys (id, public_key, private_key)
        values ('default', ${keys.publicKey}, ${keys.privateKey})
        on conflict (id) do nothing
      `)
      const rows = await tx.raw<{ public_key: string; private_key: string }>(sql`
        select public_key, private_key from app.push_vapid_keys where id = 'default' limit 1
      `)
      const row = rows[0]
      return row ? { publicKey: row.public_key, privateKey: row.private_key } : keys
    },
  )
}

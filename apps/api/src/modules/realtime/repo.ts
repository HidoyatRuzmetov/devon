// Postgres for the realtime module: shared canvases (the only way a personal canvas is ever visible
// to a colleague) and web-push subscriptions. Same shape as every other module's repo -- `Tx.raw()`
// with parameterised SQL through `@devon/db`'s public barrel, never a direct schema import, never a
// string-built query (MODULE-GUIDE.md "DB: schema").
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AuditCtx } from '../../types.js'

export type SharedCanvasScope = 'project' | 'event'

export type SharedCanvasRow = {
  id: string
  departmentId: string
  sourceCanvasId: string
  ownerUserId: string
  scope: SharedCanvasScope
  targetId: string
  title: string
  scene: unknown
  stickies: unknown
  allowEdit: boolean
  createdAt: Date
  updatedAt: Date
  updatedByUserId: string | null
  revokedAt: Date | null
  version: number
}

type SharedCanvasSqlRow = {
  id: string
  department_id: string
  source_canvas_id: string
  owner_user_id: string
  scope: SharedCanvasScope
  target_id: string
  title: string
  scene: unknown
  stickies: unknown
  allow_edit: boolean
  created_at: Date | string
  updated_at: Date | string
  updated_by_user_id: string | null
  revoked_at: Date | string | null
  version: number
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

function toSharedCanvas(r: SharedCanvasSqlRow): SharedCanvasRow {
  return {
    id: r.id,
    departmentId: r.department_id,
    sourceCanvasId: r.source_canvas_id,
    ownerUserId: r.owner_user_id,
    scope: r.scope,
    targetId: r.target_id,
    title: r.title,
    scene: r.scene,
    stickies: r.stickies,
    allowEdit: r.allow_edit,
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
    updatedByUserId: r.updated_by_user_id,
    revokedAt: r.revoked_at === null ? null : toDate(r.revoked_at),
    version: r.version,
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

// --- Shared canvases ------------------------------------------------------------------------------

export type CanvasShareInput = {
  departmentId: string
  departmentRole: 'head' | 'member'
  sourceCanvasId: string
  ownerUserId: string
  scope: SharedCanvasScope
  targetId: string
  title: string
  scene: unknown
  stickies: unknown
  allowEdit: boolean
}

/** Publishes (or re-publishes) the owner's copy. The `on conflict` clause is what makes "share this
 * canvas to this project" idempotent: pressing it twice updates the one live share instead of
 * leaving two rows nobody can tell apart. */
export async function upsertShare(
  ctx: AuditCtx,
  input: CanvasShareInput,
): Promise<SharedCanvasRow> {
  return withContext(
    toRequestContext(ctx, {
      departmentId: input.departmentId,
      departmentRole: input.departmentRole,
    }),
    async (tx) => {
      const rows = await tx.raw<SharedCanvasSqlRow>(sql`
        insert into app.shared_canvases
          (department_id, source_canvas_id, owner_user_id, scope, target_id, title, scene, stickies,
           allow_edit, updated_by_user_id)
        values (${input.departmentId}, ${input.sourceCanvasId}, ${input.ownerUserId},
                ${input.scope}::app.shared_canvas_scope, ${input.targetId}, ${input.title},
                ${JSON.stringify(input.scene ?? {})}::jsonb,
                ${JSON.stringify(input.stickies ?? [])}::jsonb,
                ${input.allowEdit}, ${input.ownerUserId})
        on conflict (source_canvas_id, scope, target_id) where revoked_at is null
        do update set title = excluded.title,
                      scene = excluded.scene,
                      stickies = excluded.stickies,
                      allow_edit = excluded.allow_edit,
                      updated_at = now(),
                      updated_by_user_id = excluded.updated_by_user_id,
                      version = app.shared_canvases.version + 1
        returning id, department_id, source_canvas_id, owner_user_id, scope, target_id, title, scene,
                  stickies, allow_edit, created_at, updated_at, updated_by_user_id, revoked_at, version
      `)
      const row = rows[0]
      if (!row) throw new Error('realtime: canvas share upsert returned no row')
      tx.audit({
        action: 'realtime.canvas_shared',
        subjectType: 'shared_canvas',
        subjectId: row.id,
        after: { scope: row.scope, targetId: row.target_id, allowEdit: row.allow_edit },
      })
      tx.emit({
        type: 'realtime.canvas.shared',
        payload: {
          sharedCanvasId: row.id,
          scope: row.scope,
          targetId: row.target_id,
          ownerUserId: row.owner_user_id,
        },
        departmentId: input.departmentId,
      })
      return toSharedCanvas(row)
    },
  )
}

export async function getShare(
  ctx: AuditCtx,
  departmentId: string,
  departmentRole: 'head' | 'member',
  id: string,
): Promise<SharedCanvasRow | null> {
  return withContext(toRequestContext(ctx, { departmentId, departmentRole }), async (tx) => {
    const rows = await tx.raw<SharedCanvasSqlRow>(sql`
      select id, department_id, source_canvas_id, owner_user_id, scope, target_id, title, scene,
             stickies, allow_edit, created_at, updated_at, updated_by_user_id, revoked_at, version
      from app.shared_canvases
      where id = ${id} and revoked_at is null
      limit 1
    `)
    return rows[0] ? toSharedCanvas(rows[0]) : null
  })
}

/** Every live share inside one department, for the "shared with me" strip on a project/event page
 * and for the owner's own list on the canvas screen. One query, never one per target (I-14). */
export async function listShares(
  ctx: AuditCtx,
  departmentId: string,
  departmentRole: 'head' | 'member',
): Promise<SharedCanvasRow[]> {
  return withContext(toRequestContext(ctx, { departmentId, departmentRole }), async (tx) => {
    const rows = await tx.raw<SharedCanvasSqlRow>(sql`
      select id, department_id, source_canvas_id, owner_user_id, scope, target_id, title, scene,
             stickies, allow_edit, created_at, updated_at, updated_by_user_id, revoked_at, version
      from app.shared_canvases
      where revoked_at is null
      order by updated_at desc
      limit 200
    `)
    return rows.map(toSharedCanvas)
  })
}

export async function updateShareDoc(
  ctx: AuditCtx,
  params: {
    departmentId: string
    departmentRole: 'head' | 'member'
    id: string
    scene: unknown
    stickies: unknown
    editorUserId: string
  },
): Promise<SharedCanvasRow | null> {
  return withContext(
    toRequestContext(ctx, {
      departmentId: params.departmentId,
      departmentRole: params.departmentRole,
    }),
    async (tx) => {
      const rows = await tx.raw<SharedCanvasSqlRow>(sql`
        update app.shared_canvases
        set scene = ${JSON.stringify(params.scene ?? {})}::jsonb,
            stickies = ${JSON.stringify(params.stickies ?? [])}::jsonb,
            updated_at = now(),
            updated_by_user_id = ${params.editorUserId},
            version = version + 1
        where id = ${params.id} and revoked_at is null
        returning id, department_id, source_canvas_id, owner_user_id, scope, target_id, title, scene,
                  stickies, allow_edit, created_at, updated_at, updated_by_user_id, revoked_at, version
      `)
      const row = rows[0]
      if (!row) return null
      // Deliberately no audit row per stroke: a collaborative canvas write happens many times a
      // minute and an audit trail of "moved a sticky" is noise that would bury the events that
      // matter (I-5's intent is the record of consequential writes). The share itself, its
      // permission change and its revocation are all audited above and below.
      return toSharedCanvas(row)
    },
  )
}

export async function revokeShare(
  ctx: AuditCtx,
  params: {
    departmentId: string
    departmentRole: 'head' | 'member'
    id: string
  },
): Promise<SharedCanvasRow | null> {
  return withContext(
    toRequestContext(ctx, {
      departmentId: params.departmentId,
      departmentRole: params.departmentRole,
    }),
    async (tx) => {
      const rows = await tx.raw<SharedCanvasSqlRow>(sql`
        update app.shared_canvases
        set revoked_at = now(), updated_at = now(), version = version + 1
        where id = ${params.id} and revoked_at is null
        returning id, department_id, source_canvas_id, owner_user_id, scope, target_id, title, scene,
                  stickies, allow_edit, created_at, updated_at, updated_by_user_id, revoked_at, version
      `)
      const row = rows[0]
      if (!row) return null
      tx.audit({
        action: 'realtime.canvas_share_revoked',
        subjectType: 'shared_canvas',
        subjectId: row.id,
        before: { scope: row.scope, targetId: row.target_id },
      })
      tx.emit({
        type: 'realtime.canvas.share_revoked',
        payload: { sharedCanvasId: row.id, scope: row.scope, targetId: row.target_id },
        departmentId: params.departmentId,
      })
      return toSharedCanvas(row)
    },
  )
}

// --- Audience lookups (who may watch a shared canvas) ---------------------------------------------

export type CanvasAudience = {
  share: SharedCanvasRow
  /** True when the asking person is the owner, a member/owner of the target project, or somebody who
   * has answered the target event -- resolved in ONE query, never a membership probe per person. */
  mayWatch: boolean
  mayEdit: boolean
}

/**
 * The database half of `channels.ts`'s `needs_lookup`. One statement answers both "does this share
 * exist" and "is this person part of the project/event it was published to".
 *
 * The rule, written once here: the owner always may; the head of the department may (they may open
 * any project and any event already); a project's owner or listed member may; anyone who has RSVP'd
 * to the event -- in any direction, including "not going" -- may, because the canvas is part of that
 * event's preparation and an invitee who cannot come may still have something to add.
 */
export async function canvasAudience(
  ctx: AuditCtx,
  params: {
    departmentId: string
    departmentRole: 'head' | 'member'
    sharedCanvasId: string
    userId: string
  },
): Promise<CanvasAudience | null> {
  return withContext(
    toRequestContext(ctx, {
      departmentId: params.departmentId,
      departmentRole: params.departmentRole,
      userId: params.userId,
    }),
    async (tx) => {
      const rows = await tx.raw<SharedCanvasSqlRow & { may_watch: boolean }>(sql`
        select s.id, s.department_id, s.source_canvas_id, s.owner_user_id, s.scope, s.target_id,
               s.title, s.scene, s.stickies, s.allow_edit, s.created_at, s.updated_at,
               s.updated_by_user_id, s.revoked_at, s.version,
               (
                 s.owner_user_id = ${params.userId}
                 or p.id is not null
                 or r.id is not null
               ) as may_watch
        from app.shared_canvases s
        left join app.projects p
          on s.scope = 'project'
         and p.id = s.target_id
         and p.deleted_at is null
         and (p.owner_user_id = ${params.userId} or ${params.userId}::uuid = any (p.members))
        left join app.event_rsvps r
          on s.scope = 'event'
         and r.event_id = s.target_id
         and r.user_id = ${params.userId}
        where s.id = ${params.sharedCanvasId} and s.revoked_at is null
        limit 1
      `)
      const row = rows[0]
      if (!row) return null
      const isHead = params.departmentRole === 'head'
      const mayWatch = row.may_watch || isHead
      return {
        share: toSharedCanvas(row),
        mayWatch,
        mayEdit: mayWatch && row.allow_edit,
      }
    },
  )
}

export type OwnCanvasRow = { id: string; title: string; scene: unknown; stickies: unknown }

/**
 * Reads one canvas *as its owner*. `app.personal_canvases` is `user_owned` with FORCE row level
 * security and no head branch (I-1), so a wrong `userId` here does not return somebody else's
 * canvas -- it returns nothing. That is the property that makes "the owner publishes a copy" safe to
 * implement as a plain read followed by an insert.
 */
export async function getOwnCanvas(userId: string, canvasId: string): Promise<OwnCanvasRow | null> {
  return withContext(toRequestContext(systemAuditCtx(userId), { userId }), async (tx) => {
    const rows = await tx.raw<{ id: string; title: string; scene: unknown; stickies: unknown }>(sql`
      select id, title, scene, stickies
      from app.personal_canvases
      where id = ${canvasId} and deleted_at is null
      limit 1
    `)
    return rows[0] ?? null
  })
}

/**
 * May this person publish a canvas into that project or that event? One statement, no branch per
 * scope at the database level:
 *   * project -- they own it or are listed in `members`;
 *   * event   -- they organise it or have answered it (any answer).
 * The head is allowed by the caller, not here, so this function stays a plain participation fact.
 */
export async function canPublishCanvasTo(
  ctx: AuditCtx,
  params: {
    departmentId: string
    departmentRole: 'head' | 'member'
    userId: string
    scope: SharedCanvasScope
    targetId: string
  },
): Promise<boolean> {
  return withContext(
    toRequestContext(ctx, {
      departmentId: params.departmentId,
      departmentRole: params.departmentRole,
      userId: params.userId,
    }),
    async (tx) => {
      const rows = await tx.raw<{ ok: boolean }>(sql`
        select exists (
          select 1 from app.projects p
          where ${params.scope} = 'project'
            and p.id = ${params.targetId}
            and p.deleted_at is null
            and (p.owner_user_id = ${params.userId} or ${params.userId}::uuid = any (p.members))
        ) or exists (
          select 1 from app.events e
          left join app.event_rsvps r on r.event_id = e.id and r.user_id = ${params.userId}
          where ${params.scope} = 'event'
            and e.id = ${params.targetId}
            and e.deleted_at is null
            and (e.organizer_user_id = ${params.userId} or r.id is not null)
        ) as ok
      `)
      if (rows[0]?.ok) return true
      // The head may publish into anything in their own department: they can already open every
      // project and every event (SPEC §2.1's `owned` rule gives them the write side of both).
      return params.departmentRole === 'head'
    },
  )
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

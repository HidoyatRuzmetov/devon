// Realtime module (v1.1 SPEC §10, EPIC-018/EPIC-019). Auto-discovered by
// `apps/api/src/module-loader.ts`; mounted directly under `/api/v1` (`prefix = ''`) because it owns
// three unrelated URL families -- `/realtime/*`, `/canvas-shares/*` and `/push/*` -- and nesting the
// last two under `/realtime` would name them after their transport instead of their subject.
//
// The security shape of this whole module, in one paragraph: browsers never publish. They ask for a
// connection token (who am I), ask for a subscription token per channel (may I listen to this), and
// POST ephemeral signals (I am typing / I am editing) that the *server* fans out with the actor taken
// from the session. So every message a colleague receives was authorised by `can()` on this side of
// the wire, and a forged "Anvar is editing this card" is not expressible. Presence is read from
// Centrifugo, not tracked here.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { can } from '@devon/contracts'
import { checkCsrf } from '../../lib/csrf.js'
import { contextDepartmentRole } from '../../lib/actor.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  boardChannel,
  canvasChannel,
  decideChannel,
  departmentChannel,
  parseChannel,
  personalChannel,
} from './channels.js'
import { canPublish, realtimeConfig } from './config.js'
import { registerRealtimeEventSubscriptions } from './events.js'
import { presence, publish, publishChannelClosed, setRealtimeLogger } from './publisher.js'
import { vapidKeys } from './push.js'
import {
  canPublishCanvasTo,
  canvasAudience,
  deletePushSubscription,
  getOwnCanvas,
  getShare,
  listPushSubscriptions,
  listShares,
  revokeShare,
  updateShareDoc,
  upsertPushSubscription,
  upsertShare,
  type SharedCanvasRow,
} from './repo.js'
import {
  presenceQuerySchema,
  presenceResponseSchema,
  pushKeySchema,
  pushSubscriptionBodySchema,
  pushSubscriptionListSchema,
  pushUnsubscribeBodySchema,
  realtimeConfigSchema,
  shareCanvasBodySchema,
  sharedCanvasListSchema,
  sharedCanvasSchema,
  signalBodySchema,
  signalResponseSchema,
  subscribeTokenBodySchema,
  tokenResponseSchema,
  updateCanvasDocBodySchema,
} from './schemas.js'
import { SERVICE_WORKER_SOURCE, SERVICE_WORKER_VERSION } from './service-worker.js'
import { signConnectionToken, signSubscriptionToken } from './tokens.js'

function auditCtxFromReq(req: FastifyRequest): AuditCtx {
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    actingForUserId: null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function activeDepartmentId(req: FastifyRequest): string {
  return req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? ''
}

/** RLS wants a concrete role; a super admin under a matching view-as reads as head and every write
 * policy still refuses them (`not app.is_view_as()`), exactly as `lib/actor.ts` documents. */
function dbDepartmentRole(req: FastifyRequest, departmentId: string): 'head' | 'member' {
  return contextDepartmentRole(req.actor ?? null, departmentId) ?? 'member'
}

function personDisplayName(user: {
  familyName: string | null
  givenName: string | null
}): string {
  return [user.familyName, user.givenName].filter(Boolean).join(' ').trim()
}

const realtimeRoutes: FastifyPluginAsyncZod = async (app) => {
  setRealtimeLogger(app.log)
  registerRealtimeEventSubscriptions(app.log, app.devonConfig.DEVON_PUBLIC_URL)

  app.addHook('onReady', async () => {
    const cfg = realtimeConfig()
    app.log.info(
      {
        enabled: cfg.enabled,
        canPublish: canPublish(cfg),
        url: cfg.CENTRIFUGO_WS_URL ? 'configured' : 'unset',
      },
      cfg.enabled
        ? 'realtime: Centrifugo configured -- live presence, typing and updates are on'
        : 'realtime: Centrifugo not configured -- the product runs on its polling fallback',
    )
  })

  // --- Connection ---------------------------------------------------------------------------------

  /** What the browser needs before it dials anything: is realtime even on, where, and which channels
   * it may treat as pre-authorised. A member and a head get exactly the same three channels -- the
   * difference between the two products is what the screens on top of them show, never the wire. */
  app.get(
    '/realtime/config',
    {
      config: {
        permission: {
          action: 'read',
          subject: () => ({ kind: 'authenticated' as const }),
        },
      },
      schema: { response: { 200: realtimeConfigSchema } },
    },
    async (req) => {
      const cfg = realtimeConfig()
      const departmentId = activeDepartmentId(req)
      const userId = req.actor!.userId
      return {
        enabled: cfg.enabled,
        url: cfg.CENTRIFUGO_WS_URL,
        channels: {
          personal: personalChannel(userId),
          department: departmentId ? departmentChannel(departmentId) : '',
          board: departmentId ? boardChannel(departmentId) : '',
        },
        ttlSeconds: cfg.CENTRIFUGO_TOKEN_TTL_SECONDS,
      }
    },
  )

  /** The connection token. Short-lived on purpose (ten minutes by default): the client refreshes
   * through this same route, which re-reads the session and the memberships, so somebody removed
   * from a department stops receiving its channel within one token life rather than whenever they
   * next reload. */
  app.get(
    '/realtime/token',
    {
      config: {
        permission: {
          action: 'read',
          subject: () => ({ kind: 'authenticated' as const }),
        },
      },
      schema: {
        response: { 200: tokenResponseSchema, 503: z.object({ code: z.string() }) },
      },
    },
    async (req, reply) => {
      const cfg = realtimeConfig()
      // 503, not 500 and not an empty 200: "this deployment has no realtime service" is a
      // configuration fact the client renders as its offline-ish live state, not an error.
      if (!cfg.enabled) return reply.code(503).send({ code: 'realtime_disabled' })
      const userId = req.actor!.userId
      const user = await app.devon.findUserById(userId)
      const token = signConnectionToken(
        {
          userId,
          ttlSeconds: cfg.CENTRIFUGO_TOKEN_TTL_SECONDS,
          info: {
            name: user ? personDisplayName(user) : '',
            avatarKey: user?.avatarKey ?? null,
          },
          // The person's own inbox channel is subscribed server-side, from the token itself: the
          // answer to "may I listen to my own notifications" can never be anything but yes, so it
          // does not deserve a round trip. Centrifugo's `#` user boundary independently refuses the
          // channel to any other connection.
          channels: [personalChannel(userId)],
        },
        cfg.CENTRIFUGO_TOKEN_HMAC_SECRET_KEY,
      )
      return reply.send({
        token,
        expiresAt: new Date(Date.now() + cfg.CENTRIFUGO_TOKEN_TTL_SECONDS * 1000).toISOString(),
      })
    },
  )

  /**
   * A subscription token for exactly one channel -- the `can()` call that makes a channel name
   * meaningful. `channels.ts` decides everything answerable from the actor; a `canvas:` channel is
   * the one case that needs the database, and it is resolved here before anything is signed.
   */
  app.post(
    '/realtime/subscribe-token',
    {
      config: {
        permission: {
          action: 'read',
          subject: () => ({ kind: 'authenticated' as const }),
        },
      },
      schema: {
        body: subscribeTokenBodySchema,
        response: {
          200: tokenResponseSchema,
          403: z.object({ code: z.string() }),
          503: z.object({ code: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const cfg = realtimeConfig()
      if (!cfg.enabled) return reply.code(503).send({ code: 'realtime_disabled' })
      const parsed = parseChannel(req.body.channel)
      const decision = decideChannel(req.actor ?? null, parsed)

      if (!decision.allowed && decision.reason !== 'needs_lookup') {
        return reply.code(403).send({ code: 'forbidden' })
      }

      if (!decision.allowed && parsed?.namespace === 'canvas') {
        const departmentId = activeDepartmentId(req)
        if (!departmentId) return reply.code(403).send({ code: 'forbidden' })
        const audience = await canvasAudience(auditCtxFromReq(req), {
          departmentId,
          departmentRole: dbDepartmentRole(req, departmentId),
          sharedCanvasId: parsed.sharedCanvasId,
          userId: req.actor!.userId,
        })
        if (!audience || !audience.mayWatch) return reply.code(403).send({ code: 'forbidden' })
      }

      const token = signSubscriptionToken(
        {
          userId: req.actor!.userId,
          channel: req.body.channel,
          ttlSeconds: cfg.CENTRIFUGO_TOKEN_TTL_SECONDS,
        },
        cfg.CENTRIFUGO_TOKEN_HMAC_SECRET_KEY,
      )
      return reply.send({
        token,
        expiresAt: new Date(Date.now() + cfg.CENTRIFUGO_TOKEN_TTL_SECONDS * 1000).toISOString(),
      })
    },
  )

  /** Who is on the board (or on a shared canvas) right now. Answered by Centrifugo, gated by exactly
   * the same rule as the subscription itself -- a channel nobody may join is a channel whose
   * presence nobody may read. */
  app.get(
    '/realtime/presence',
    {
      config: {
        permission: {
          action: 'read',
          subject: () => ({ kind: 'authenticated' as const }),
        },
      },
      schema: {
        querystring: presenceQuerySchema,
        response: { 200: presenceResponseSchema, 403: z.object({ code: z.string() }) },
      },
    },
    async (req, reply) => {
      const parsed = parseChannel(req.query.channel)
      const decision = decideChannel(req.actor ?? null, parsed)
      if (!decision.allowed && decision.reason !== 'needs_lookup') {
        return reply.code(403).send({ code: 'forbidden' })
      }
      if (!decision.allowed && parsed?.namespace === 'canvas') {
        const departmentId = activeDepartmentId(req)
        const audience = departmentId
          ? await canvasAudience(auditCtxFromReq(req), {
              departmentId,
              departmentRole: dbDepartmentRole(req, departmentId),
              sharedCanvasId: parsed.sharedCanvasId,
              userId: req.actor!.userId,
            })
          : null
        if (!audience || !audience.mayWatch) return reply.code(403).send({ code: 'forbidden' })
      }
      const people = await presence(req.query.channel)
      return reply.send({ people: people ?? [], available: people !== null })
    },
  )

  /**
   * Ephemeral board signals: "I have this card open", "I am typing a comment". They are never
   * stored, never audited and never notified -- they exist for the two seconds a colleague needs to
   * know not to type over somebody. The actor comes from the session; the body carries only which
   * card, so nobody can put words in a colleague's mouth.
   */
  app.post(
    '/realtime/signal',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({
            kind: 'department_child' as const,
            departmentId: activeDepartmentId(r),
          }),
        },
      },
      schema: { body: signalBodySchema, response: { 200: signalResponseSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = activeDepartmentId(req)
      const delivered = await publish(boardChannel(departmentId), {
        type: `board.${req.body.kind}`,
        payload: { cardId: req.body.cardId, userId: req.actor!.userId },
        actorUserId: req.actor!.userId,
      })
      return reply.send({ delivered })
    },
  )

  // --- Shared canvases ------------------------------------------------------------------------------

  function toShareDto(
    row: SharedCanvasRow,
    opts: { canEdit: boolean; canManage: boolean },
  ): z.infer<typeof sharedCanvasSchema> {
    return {
      id: row.id,
      departmentId: row.departmentId,
      sourceCanvasId: row.sourceCanvasId,
      ownerUserId: row.ownerUserId,
      scope: row.scope,
      targetId: row.targetId,
      title: row.title,
      scene: row.scene,
      stickies: row.stickies,
      allowEdit: row.allowEdit,
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      canEdit: opts.canEdit,
      canManage: opts.canManage,
      channel: canvasChannel(row.id),
    }
  }

  /**
   * Publish a copy of one private canvas to a project or an event (v1.1 SPEC §10's sharing rule,
   * written out in the migration). Two permission questions, both answered here:
   *   1. is this the owner's own canvas? -- `{kind:'personal'}`, which has no head exception (I-1);
   *   2. may they publish into that project/event? -- they must be part of it, which the audience
   *      lookup answers after the row exists, and which the target's own membership answers before.
   */
  app.post(
    '/canvas-shares',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({
            kind: 'department_child' as const,
            departmentId: activeDepartmentId(r),
          }),
        },
      },
      schema: {
        body: shareCanvasBodySchema,
        response: {
          200: sharedCanvasSchema,
          403: z.object({ code: z.string() }),
          404: z.object({ code: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = activeDepartmentId(req)
      const userId = req.actor!.userId
      if (!departmentId) return reply.code(403).send({ code: 'not_a_member' })

      const canvas = await getOwnCanvas(userId, req.body.canvasId)
      if (!canvas) return reply.code(404).send({ code: 'not_found' })
      // Said through `can()` rather than an `===` so there is one implementation of "only the owner"
      // in the codebase (I-7), and so a future delegation grant cannot accidentally bypass it here.
      if (!can(req.actor ?? null, 'update', { kind: 'personal', ownerUserId: userId }).allowed) {
        return reply.code(403).send({ code: 'forbidden' })
      }

      const targetOk = await canPublishCanvasTo(auditCtxFromReq(req), {
        departmentId,
        departmentRole: dbDepartmentRole(req, departmentId),
        userId,
        scope: req.body.scope,
        targetId: req.body.targetId,
      })
      if (!targetOk) return reply.code(403).send({ code: 'not_a_participant' })

      const row = await upsertShare(auditCtxFromReq(req), {
        departmentId,
        departmentRole: dbDepartmentRole(req, departmentId),
        sourceCanvasId: canvas.id,
        ownerUserId: userId,
        scope: req.body.scope,
        targetId: req.body.targetId,
        title: canvas.title,
        scene: canvas.scene,
        stickies: canvas.stickies,
        allowEdit: req.body.allowEdit,
      })
      await publish(departmentChannel(departmentId), {
        type: 'realtime.canvas.shared',
        payload: { sharedCanvasId: row.id, scope: row.scope, targetId: row.targetId },
        actorUserId: userId,
      })
      return reply.send(toShareDto(row, { canEdit: true, canManage: true }))
    },
  )

  app.get(
    '/canvas-shares',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({
            kind: 'department_child' as const,
            departmentId: activeDepartmentId(r),
          }),
        },
      },
      schema: { response: { 200: sharedCanvasListSchema } },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      if (!departmentId) return reply.send({ items: [] })
      const rows = await listShares(
        auditCtxFromReq(req),
        departmentId,
        dbDepartmentRole(req, departmentId),
      )
      return reply.send({
        items: rows.map((row) => ({
          id: row.id,
          departmentId: row.departmentId,
          sourceCanvasId: row.sourceCanvasId,
          ownerUserId: row.ownerUserId,
          scope: row.scope,
          targetId: row.targetId,
          title: row.title,
          allowEdit: row.allowEdit,
          updatedAt: row.updatedAt.toISOString(),
          version: row.version,
          canManage: row.ownerUserId === req.actor!.userId,
        })),
      })
    },
  )

  app.get(
    '/canvas-shares/:id',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({
            kind: 'department_child' as const,
            departmentId: activeDepartmentId(r),
          }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: sharedCanvasSchema,
          403: z.object({ code: z.string() }),
          404: z.object({ code: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      if (!departmentId) return reply.code(404).send({ code: 'not_found' })
      const audience = await canvasAudience(auditCtxFromReq(req), {
        departmentId,
        departmentRole: dbDepartmentRole(req, departmentId),
        sharedCanvasId: req.params.id,
        userId: req.actor!.userId,
      })
      // 404 for a share that does not exist, 403 for one that does and is not this person's to see:
      // the same two-code split `work/index.ts`'s `requireCardOwnership` uses, so an id probe cannot
      // tell "no such canvas" from "someone else's canvas".
      if (!audience) return reply.code(404).send({ code: 'not_found' })
      if (!audience.mayWatch) return reply.code(403).send({ code: 'forbidden' })
      return reply.send(
        toShareDto(audience.share, {
          canEdit: audience.mayEdit,
          canManage: audience.share.ownerUserId === req.actor!.userId,
        }),
      )
    },
  )

  app.patch(
    '/canvas-shares/:id',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'department_child' as const,
            departmentId: activeDepartmentId(r),
          }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: updateCanvasDocBodySchema,
        response: {
          200: sharedCanvasSchema,
          403: z.object({ code: z.string() }),
          404: z.object({ code: z.string() }),
          409: z.object({ code: z.string(), version: z.number().int() }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = activeDepartmentId(req)
      if (!departmentId) return reply.code(404).send({ code: 'not_found' })
      const audience = await canvasAudience(auditCtxFromReq(req), {
        departmentId,
        departmentRole: dbDepartmentRole(req, departmentId),
        sharedCanvasId: req.params.id,
        userId: req.actor!.userId,
      })
      if (!audience) return reply.code(404).send({ code: 'not_found' })
      if (!audience.mayEdit) return reply.code(403).send({ code: 'forbidden' })
      if (
        req.body.baseVersion !== undefined &&
        req.body.baseVersion !== audience.share.version
      ) {
        return reply.code(409).send({ code: 'stale_version', version: audience.share.version })
      }

      const row = await updateShareDoc(auditCtxFromReq(req), {
        departmentId,
        departmentRole: dbDepartmentRole(req, departmentId),
        id: req.params.id,
        scene: req.body.scene,
        stickies: req.body.stickies,
        editorUserId: req.actor!.userId,
      })
      if (!row) return reply.code(404).send({ code: 'not_found' })
      await publish(canvasChannel(row.id), {
        type: 'canvas.doc.updated',
        payload: { sharedCanvasId: row.id, version: row.version },
        actorUserId: req.actor!.userId,
      })
      return reply.send(
        toShareDto(row, {
          canEdit: true,
          canManage: row.ownerUserId === req.actor!.userId,
        }),
      )
    },
  )

  /** Revoking is the owner's alone (or the head's, by `owned`'s rule): the canvas came out of their
   * private workspace, so the decision to take it back is theirs. */
  app.delete(
    '/canvas-shares/:id',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => ({
            kind: 'department_child' as const,
            departmentId: activeDepartmentId(r),
          }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ revoked: z.boolean() }),
          403: z.object({ code: z.string() }),
          404: z.object({ code: z.string() }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = activeDepartmentId(req)
      if (!departmentId) return reply.code(404).send({ code: 'not_found' })
      const existing = await getShare(
        auditCtxFromReq(req),
        departmentId,
        dbDepartmentRole(req, departmentId),
        req.params.id,
      )
      if (!existing) return reply.code(404).send({ code: 'not_found' })
      const allowed = can(req.actor ?? null, 'delete', {
        kind: 'owned',
        departmentId,
        ownerUserIds: [existing.ownerUserId],
      })
      if (!allowed.allowed) return reply.code(403).send({ code: allowed.reason })

      const row = await revokeShare(auditCtxFromReq(req), {
        departmentId,
        departmentRole: dbDepartmentRole(req, departmentId),
        id: req.params.id,
      })
      if (!row) return reply.code(404).send({ code: 'not_found' })
      await publishChannelClosed(canvasChannel(row.id), 'revoked')
      await publish(departmentChannel(departmentId), {
        type: 'realtime.canvas.share_revoked',
        payload: { sharedCanvasId: row.id, scope: row.scope, targetId: row.targetId },
        actorUserId: req.actor!.userId,
      })
      return reply.send({ revoked: true })
    },
  )

  // --- Web push ------------------------------------------------------------------------------------

  /** The public half of this deployment's VAPID identity. Public by definition -- it is what a
   * browser hands to Google/Mozilla/Apple when it subscribes -- but still behind a session, because
   * there is no reason for an anonymous visitor to learn anything about this box. */
  app.get(
    '/push/key',
    {
      config: {
        permission: {
          action: 'read',
          subject: () => ({ kind: 'authenticated' as const }),
        },
      },
      schema: { response: { 200: pushKeySchema } },
    },
    async (_req, reply) => {
      try {
        const keys = await vapidKeys()
        return reply.send({ enabled: true, publicKey: keys.publicKey })
      } catch (err) {
        app.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'push: VAPID keys unavailable -- web push stays off',
        )
        return reply.send({ enabled: false, publicKey: '' })
      }
    },
  )

  app.get(
    '/push/subscriptions',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: pushSubscriptionListSchema } },
    },
    async (req, reply) => {
      const rows = await listPushSubscriptions(req.actor!.userId)
      return reply.send({
        items: rows.map((r) => ({
          id: r.id,
          browserLabel: r.browserLabel,
          createdAt: r.createdAt.toISOString(),
          lastSeenAt: r.lastSeenAt.toISOString(),
        })),
      })
    },
  )

  app.post(
    '/push/subscriptions',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        body: pushSubscriptionBodySchema,
        response: { 200: z.object({ id: z.string() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await upsertPushSubscription(auditCtxFromReq(req), {
        userId: req.actor!.userId,
        endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh,
        authSecret: req.body.keys.auth,
        browserLabel: req.body.browserLabel,
        locale: req.body.locale,
      })
      return reply.send({ id: row.id })
    },
  )

  app.post(
    '/push/unsubscribe',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        body: pushUnsubscribeBodySchema,
        response: { 200: z.object({ removed: z.boolean() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const removed = await deletePushSubscription(
        auditCtxFromReq(req),
        req.actor!.userId,
        req.body.endpoint,
      )
      return reply.send({ removed })
    },
  )

  /** The push service worker's own source (see `service-worker.ts` for why it is served from the API
   * rather than shipped as a static file).
   *
   * `Service-Worker-Allowed: /` widens the worker's scope from its own path to the whole origin,
   * which is what lets `navigator.serviceWorker.register('/api/v1/realtime/sw.js', { scope: '/' })`
   * succeed. Authenticated, not public: `register()` and the browser's own update checks both fetch
   * the script `credentials: 'same-origin'`, so the session cookie is on the request -- and there is
   * no reason for an anonymous visitor to be able to enumerate this deployment's client code.
   *
   * `no-cache` (not `no-store`): the browser must be able to byte-compare the script it holds against
   * the one it fetches on every update check, which is exactly how a fixed worker replaces a broken
   * one. `no-store` would work too but re-downloads on every navigation for no benefit. */
  app.get(
    '/realtime/sw.js',
    {
      config: {
        permission: {
          action: 'read',
          subject: () => ({ kind: 'authenticated' as const }),
        },
      },
      schema: {},
    },
    async (_req, reply) =>
      reply
        .header('content-type', 'application/javascript; charset=utf-8')
        .header('service-worker-allowed', '/')
        .header('cache-control', 'no-cache')
        .header('x-devon-sw-version', SERVICE_WORKER_VERSION)
        .send(SERVICE_WORKER_SOURCE),
  )

  // Deliberately no head-only surface in this module. Presence and typing are peer facts; a "who is
  // online" console for the boshqarma boshligʻi would be surveillance rather than management, which
  // is SPEC §2.2's "no leaderboard anywhere" applied to the live layer.
}

export default realtimeRoutes
export const prefix = ''

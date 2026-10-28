// Realtime module (v1.1 SPEC §10, EPIC-018/EPIC-019). Auto-discovered by
// `apps/api/src/module-loader.ts`; mounted directly under `/api/v1` (`prefix = ''`) because it owns
// two URL families -- `/realtime/*` and `/push/*` -- and nesting push under `/realtime` would name them after their transport instead of their subject.
//
// The security shape of this whole module, in one paragraph: browsers never publish. They ask for a
// connection token (who am I), ask for a subscription token per channel (may I listen to this), and
// POST ephemeral signals (I am typing / I am editing) that the *server* fans out with the actor taken
// from the session. So every message a colleague receives was authorised by `can()` on this side of
// the wire, and a forged "Anvar is editing this card" is not expressible. Presence is read from
// Centrifugo, not tracked here.
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  boardChannel,
  decideChannel,
  departmentChannel,
  parseChannel,
  personalChannel,
} from './channels.js'
import { canPublish, realtimeConfig } from './config.js'
import { registerRealtimeEventSubscriptions } from './events.js'
import { presence, publish, setRealtimeLogger } from './publisher.js'
import { vapidKeys } from './push.js'
import { deletePushSubscription, listPushSubscriptions, upsertPushSubscription } from './repo.js'
import {
  presenceQuerySchema,
  presenceResponseSchema,
  pushKeySchema,
  pushSubscriptionBodySchema,
  pushSubscriptionListSchema,
  pushUnsubscribeBodySchema,
  realtimeConfigSchema,
  signalBodySchema,
  signalResponseSchema,
  subscribeTokenBodySchema,
  tokenResponseSchema,
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

function personDisplayName(user: { familyName: string | null; givenName: string | null }): string {
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
   * meaningful. `channels.ts` checks the actor before any subscription token is signed.
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

      if (!decision.allowed) {
        return reply.code(403).send({ code: 'forbidden' })
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
      if (!decision.allowed) {
        return reply.code(403).send({ code: 'forbidden' })
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
      // The display name travels with the signal so a receiving board can render "Anvar is editing
      // this" without a lookup per card -- and it is taken from the *session's* actor, never from
      // the body, which is what makes "Anvar is editing this" unforgeable.
      //
      // A colleague's name inside their own department is not personal data this endpoint is
      // disclosing (the board already shows it on every card), and it is the only field added: no
      // avatar, no login, no contact detail (I-2).
      const delivered = await publish(boardChannel(departmentId), {
        type: `board.${req.body.kind}`,
        payload: {
          cardId: req.body.cardId,
          userId: req.actor!.userId,
          name: req.actorUser ? personDisplayName(req.actorUser) : '',
        },
        actorUserId: req.actor!.userId,
      })
      return reply.send({ delivered })
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

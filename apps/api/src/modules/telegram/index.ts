// Telegram module (TECH-SPEC §7): personal linking (`/start <code>` + QR), department group
// connection, webhook route + local-dev polling fallback, commands and inline-button actions
// (`bot.ts`). Mounted at `/api/v1/telegram` (MODULE-GUIDE.md "API modules").
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Update } from 'grammy/types'
import { z } from 'zod'
import QRCode from 'qrcode'
import type { FastifyRequest } from 'fastify'
import type { Config } from '../../config.js'
import { checkCsrf } from '../../lib/csrf.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  disconnectGroup,
  getLinkStatus,
  issueGroupConnectCode,
  issueLinkCode,
  listGroupsForDepartment,
  readWhoCanConnectGroup,
  setGroupKinds,
  unlink,
} from './repo.js'
import { isHeadOf } from '../../lib/actor.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { registerBotHandlers } from './bot.js'
import { secretsEqual, TELEGRAM_SECRET_HEADER, UpdateReplayWindow } from './webhook-guard.js'
import { configureTelegram, getBot, isTelegramConfigured, publicUrl } from './transport.js'
import {
  groupConnectCodeSchema,
  groupListSchema,
  linkCodeSchema,
  linkStatusSchema,
  muteBodySchema,
  putGroupKindsSchema,
  webhookParamsSchema,
} from './schemas.js'

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

// H1.14/H7.3: the webhook secret, the bot token and the bot username are parsed and validated once,
// at boot, by `apps/api/src/config.ts` (a secret shorter than 32 CSPRNG characters is now a refused
// boot, not a silently weak webhook path) -- never re-read from `process.env` per request.
function readWebhookSecret(app: { devonConfig: Config }): string | null {
  return app.devonConfig.TELEGRAM_WEBHOOK_SECRET ?? null
}

/** Process-wide, bounded (`webhook-guard.ts`). One bot per process, so one window. */
const replayWindow = new UpdateReplayWindow()

let botHandlersRegistered = false
let pollingHandle: { stop(): Promise<void> } | null = null

const telegramRoutes: FastifyPluginAsyncZod = async (app) => {
  // Hand this module its boot-validated configuration before anything asks for a bot (H7.3).
  configureTelegram(app.devonConfig)
  const bot = getBot()
  if (bot && !botHandlersRegistered) {
    registerBotHandlers(bot)
    botHandlersRegistered = true
  }

  // --- Personal linking ------------------------------------------------------------------------------

  app.get(
    '/telegram/status',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: linkStatusSchema } },
    },
    async (req, reply) => {
      const status = await getLinkStatus(req.actor!.userId)
      const botUsername = app.devonConfig.TELEGRAM_BOT_USERNAME ?? null
      reply.send({
        linked: status.linked,
        linkedAt: status.linkedAt ? status.linkedAt.toISOString() : null,
        mutedUntil: status.mutedUntil ? status.mutedUntil.toISOString() : null,
        botUsername,
      })
    },
  )

  app.post(
    '/telegram/link-code',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: linkCodeSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { code, expiresAt } = await issueLinkCode(req.actor!.userId)
      const botUsername = app.devonConfig.TELEGRAM_BOT_USERNAME
      const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : null
      let qrDataUrl: string | null = null
      if (deepLink) {
        try {
          qrDataUrl = await QRCode.toDataURL(deepLink, { margin: 1, width: 240 })
        } catch {
          qrDataUrl = null // QR is a convenience; the code and deep link above are always usable without it.
        }
      }
      reply.send({ code, deepLink, expiresAt: expiresAt.toISOString(), qrDataUrl })
    },
  )

  app.post(
    '/telegram/unlink',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 204: z.void() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await unlink(auditCtxFromReq(req), req.actor!.userId)
      reply.code(204).send()
    },
  )

  // --- Department groups (`department_child` to view, `department` -- head only -- to change) --------

  app.get(
    '/telegram/departments/:departmentId/groups',
    {
      config: {
        permission: {
          action: 'read',
          // D8: a group chat id is an operational credential. The UI already hid this card behind
          // `isHead`; the server now agrees instead of leaving the GET open to every member.
          subject: (r) => ({
            kind: 'department_managed',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid() }),
        response: { 200: groupListSchema },
      },
    },
    async (req, reply) => {
      const { departmentId } = req.params
      const groups = await listGroupsForDepartment(departmentId)
      reply.send({
        items: groups.map((g) => ({
          id: g.id,
          chatId: g.chatId,
          title: g.title,
          kinds: g.kinds,
          connectedAt: g.connectedAt.toISOString(),
        })),
      })
    },
  )

  app.post(
    '/telegram/departments/:departmentId/connect-code',
    {
      config: {
        permission: {
          action: 'create',
          // D9: `can()` proves membership; the department's own `whoCanConnectTelegramGroup` setting
          // decides whether a member may connect a group, and is honoured in the handler below.
          // Renaming and disconnecting an existing group stay `{kind:'department'}` (head-only).
          subject: (r) => ({
            kind: 'department_child',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid() }),
        response: { 200: groupConnectCodeSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { departmentId } = req.params
      const policy = await readWhoCanConnectGroup(departmentId)
      if (policy !== 'everyone' && !isHeadOf(req.actor, departmentId)) {
        return sendProblem(reply, 'forbidden')
      }
      const { code, expiresAt } = await issueGroupConnectCode(departmentId, req.actor!.userId)
      reply.send({ code, expiresAt: expiresAt.toISOString() })
    },
  )

  app.patch(
    '/telegram/departments/:departmentId/groups/:groupId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'department',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid(), groupId: z.string().uuid() }),
        body: putGroupKindsSchema,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { departmentId, groupId } = req.params
      await setGroupKinds(auditCtxFromReq(req), groupId, departmentId, req.body.kinds)
      reply.code(204).send()
    },
  )

  app.delete(
    '/telegram/departments/:departmentId/groups/:groupId',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => ({
            kind: 'department',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid(), groupId: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { departmentId, groupId } = req.params
      await disconnectGroup(auditCtxFromReq(req), groupId, departmentId)
      reply.code(204).send()
    },
  )

  // --- Personal mute (a convenience mirror of the bot's own `/mute`, for the web Settings screen) ----

  app.post(
    '/telegram/mute',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { body: muteBodySchema, response: { 204: z.void() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { setMutedUntil } = await import('./repo.js')
      await setMutedUntil(
        req.actor!.userId,
        req.body.minutes > 0 ? new Date(Date.now() + req.body.minutes * 60_000) : null,
      )
      reply.code(204).send()
    },
  )

  // --- Webhook (public: Telegram itself calls this, with no session cookie) --------------------------

  app.post(
    '/telegram/webhook/:secret',
    {
      config: {
        permission: { public: true },
        // H1.9: an unauthenticated, internet-reachable POST. Telegram's own delivery rate for one
        // bot is far below this; anything above it is someone else's traffic.
        rateLimit: { max: 120, timeWindow: '1 minute' },
      },
      schema: { params: webhookParamsSchema, body: z.record(z.string(), z.unknown()) },
    },
    async (req, reply) => {
      const expected = readWebhookSecret(app)
      const current = getBot()
      // Both copies of the secret must match, both in constant time (H1.14, `webhook-guard.ts`):
      // the one in the path (which Telegram echoes because we chose that URL) and the one in
      // `X-Telegram-Bot-Api-Secret-Token` (which only Telegram, holding the value passed to
      // `setWebhook`, can produce -- and which never appears in a proxy access log).
      const headerSecret = req.headers[TELEGRAM_SECRET_HEADER]
      const headerValue = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret
      if (
        !expected ||
        !current ||
        !secretsEqual(req.params.secret, expected) ||
        !secretsEqual(headerValue, expected)
      ) {
        // 404, never 401/403: an unauthenticated prober must not be able to tell a wrong secret
        // from a bot that is not configured at all.
        reply.code(404).send()
        return
      }
      // H10.1 replay protection. `update_id` is Telegram's own monotonic per-bot sequence number; a
      // captured delivery replayed against this endpoint is answered 200 (so a genuine Telegram
      // retry is never re-driven either) but is not handled a second time.
      const updateId = (req.body as { update_id?: unknown }).update_id
      if (typeof updateId !== 'number' || !replayWindow.accept(updateId)) {
        reply.code(200).send({ ok: true })
        return
      }
      try {
        await current.handleUpdate(req.body as unknown as Update)
      } catch (err) {
        req.log.error({ err }, 'telegram: webhook update handling failed')
      }
      reply.code(200).send({ ok: true })
    },
  )

  // --- Boot-time wiring: webhook registration in production, long-polling fallback in dev ------------

  app.addHook('onReady', async () => {
    if (!isTelegramConfigured() || app.devonConfig.NODE_ENV === 'test') return
    const activeBot = getBot()
    if (!activeBot) return
    try {
      await activeBot.init()
    } catch (err) {
      app.log.warn(
        { err },
        'telegram: bot.init() failed (no network to Telegram, or an invalid token) -- staying in no-op mode',
      )
      return
    }

    const secret = readWebhookSecret(app)
    if (app.devonConfig.NODE_ENV === 'production' && secret) {
      const url = `${publicUrl()}/api/v1/telegram/webhook/${secret}`
      try {
        await activeBot.api.setWebhook(url, { secret_token: secret })
        // H1.11/H1.1: the URL contains the webhook secret -- logging it (as this line used to)
        // wrote a live credential into every log sink and every backup of them. The path is a
        // constant plus that secret, so there is nothing left worth logging but the fact.
        app.log.info({}, 'telegram: webhook registered')
      } catch (err) {
        app.log.warn(
          { err },
          'telegram: setWebhook failed -- falling back to long polling for this process',
        )
        pollingHandle = startPolling(activeBot, app.log)
      }
    } else {
      pollingHandle = startPolling(activeBot, app.log)
    }
  })

  app.addHook('onClose', async () => {
    if (pollingHandle) await pollingHandle.stop().catch(() => {})
  })
}

function startPolling(
  bot: NonNullable<ReturnType<typeof getBot>>,
  log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void },
): { stop(): Promise<void> } {
  // Fire-and-forget: `bot.start()` resolves only once polling stops, so this must not be awaited by
  // the caller (MODULE-GUIDE.md's own "no query in a loop"-style caution generalises: never await an
  // intentionally long-running loop from a boot hook).
  void bot
    .start({
      onStart: () =>
        log.info(
          {},
          'telegram: long-polling fallback started (local dev -- no TELEGRAM_WEBHOOK_SECRET/production webhook)',
        ),
    })
    .catch((err) => log.error({ err }, 'telegram: long-polling loop exited'))
  return { stop: () => bot.stop() }
}

export default telegramRoutes
export const prefix = ''

// Telegram module (TECH-SPEC §7): personal linking (`/start <code>` + QR), department group
// connection, webhook route + local-dev polling fallback, commands and inline-button actions
// (`bot.ts`). Mounted at `/api/v1/telegram` (MODULE-GUIDE.md "API modules").
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Update } from 'grammy/types'
import { z } from 'zod'
import QRCode from 'qrcode'
import type { FastifyRequest } from 'fastify'
import { checkCsrf } from '../../lib/csrf.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  disconnectGroup,
  getLinkStatus,
  issueGroupConnectCode,
  issueLinkCode,
  listGroupsForDepartment,
  setGroupKinds,
  unlink,
} from './repo.js'
import { registerBotHandlers } from './bot.js'
import { getBot, isTelegramConfigured, publicUrl } from './transport.js'
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

function readWebhookSecret(): string | null {
  const raw = process.env['TELEGRAM_WEBHOOK_SECRET']
  const trimmed = raw?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

let botHandlersRegistered = false
let pollingHandle: { stop(): Promise<void> } | null = null

const telegramRoutes: FastifyPluginAsyncZod = async (app) => {
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
      const botUsername = process.env['TELEGRAM_BOT_USERNAME']?.trim() || null
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
      const botUsername = process.env['TELEGRAM_BOT_USERNAME']?.trim()
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
          subject: (r) => ({
            kind: 'department_child',
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
          subject: (r) => ({
            kind: 'department',
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
      config: { permission: { public: true } },
      schema: { params: webhookParamsSchema, body: z.record(z.string(), z.unknown()) },
    },
    async (req, reply) => {
      const expected = readWebhookSecret()
      const current = getBot()
      if (!expected || !current || req.params.secret !== expected) {
        reply.code(404).send()
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

    const secret = readWebhookSecret()
    if (app.devonConfig.NODE_ENV === 'production' && secret) {
      const url = `${publicUrl()}/api/v1/telegram/webhook/${secret}`
      try {
        await activeBot.api.setWebhook(url, { secret_token: secret })
        app.log.info({ url }, 'telegram: webhook registered')
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

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
import { tb, type BotLocale } from './templates.js'
import { secretsEqual, TELEGRAM_SECRET_HEADER, UpdateReplayWindow } from './webhook-guard.js'
import { webhookOptions } from './webhook-options.js'
import { startTelegramPolling } from './polling.js'
import {
  botUsername as resolvedBotUsername,
  configureTelegram,
  getBot,
  isTelegramAvailable,
  isTelegramConfigured,
  publicUrl,
} from './transport.js'
import miniappRoutes, { miniappUrl } from './miniapp.js'
import { setupCounts } from './miniapp-repo.js'
import { setupChecklistSchema } from './miniapp-schemas.js'
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
const pendingUpdates = new Set<number>()

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
          subject: (r) => ({
            kind: 'personal',
            ownerUserId: r.actor?.userId ?? '',
          }),
        },
      },
      schema: { response: { 200: linkStatusSchema } },
    },
    async (req, reply) => {
      const status = await getLinkStatus(req.actor!.userId)
      const botUsername = resolvedBotUsername()
      const departmentId = req.actor?.departmentId
      const canConnectGroup = Boolean(
        departmentId &&
        (isHeadOf(req.actor, departmentId) ||
          (await readWhoCanConnectGroup(departmentId)) === 'everyone'),
      )
      return reply.send({
        linked: status.linked,
        linkedAt: status.linkedAt ? status.linkedAt.toISOString() : null,
        mutedUntil: status.mutedUntil ? status.mutedUntil.toISOString() : null,
        botUsername,
        configured: isTelegramConfigured(),
        available: isTelegramAvailable(),
        canConnectGroup,
      })
    },
  )

  app.post(
    '/telegram/link-code',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({
            kind: 'personal',
            ownerUserId: r.actor?.userId ?? '',
          }),
        },
      },
      schema: { response: { 200: linkCodeSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (!isTelegramConfigured()) return sendProblem(reply, 'internal')
      const { code, expiresAt } = await issueLinkCode(req.actor!.userId)
      const botUsername = resolvedBotUsername()
      const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : null
      let qrDataUrl: string | null = null
      if (deepLink) {
        try {
          qrDataUrl = await QRCode.toDataURL(deepLink, {
            margin: 1,
            width: 240,
          })
        } catch {
          qrDataUrl = null // QR is a convenience; the code and deep link above are always usable without it.
        }
      }
      return reply.send({
        code,
        deepLink,
        expiresAt: expiresAt.toISOString(),
        qrDataUrl,
      })
    },
  )

  app.post(
    '/telegram/unlink',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => ({
            kind: 'personal',
            ownerUserId: r.actor?.userId ?? '',
          }),
        },
      },
      schema: { response: { 204: z.void() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await unlink(auditCtxFromReq(req), req.actor!.userId)
      return reply.code(204).send()
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
      return reply.send({
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
      return reply.send({ code, expiresAt: expiresAt.toISOString() })
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
        params: z.object({
          departmentId: z.string().uuid(),
          groupId: z.string().uuid(),
        }),
        body: putGroupKindsSchema,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { departmentId, groupId } = req.params
      await setGroupKinds(auditCtxFromReq(req), groupId, departmentId, req.body.kinds)
      return reply.code(204).send()
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
        params: z.object({
          departmentId: z.string().uuid(),
          groupId: z.string().uuid(),
        }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { departmentId, groupId } = req.params
      await disconnectGroup(auditCtxFromReq(req), groupId, departmentId)
      return reply.code(204).send()
    },
  )

  // --- Personal mute (a convenience mirror of the bot's own `/mute`, for the web Settings screen) ----

  app.post(
    '/telegram/mute',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'personal',
            ownerUserId: r.actor?.userId ?? '',
          }),
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
      return reply.code(204).send()
    },
  )

  // --- Mini App (v1.1 SPEC §9, EPIC-015) -------------------------------------------------------------

  // Its own encapsulation context, so the `initData` `onRequest` hook it installs on its sign-in
  // route cannot leak onto any other route in this module (`miniapp.ts` header).
  await app.register(miniappRoutes, { prefix: '/telegram/miniapp' })

  /**
   * The head's "is Telegram actually wired up?" answer (SPEC §9: "the department settings show the
   * bot username and a setup checklist for the head"). `department_managed`, so a xodim never sees
   * the instance's bot configuration -- the same reasoning that already makes the group list
   * head-only (D8). Listed in `apps/api/test/unit/head-only-routes.test.ts`.
   */
  app.get(
    '/telegram/departments/:departmentId/setup-checklist',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({
            kind: 'department_managed',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid() }),
        response: { 200: setupChecklistSchema },
      },
    },
    async (req, reply) => {
      const { departmentId } = req.params
      const counts = await setupCounts(
        {
          requestId: req.id,
          userId: req.actor?.userId ?? null,
          actorRole: req.actor?.role ?? null,
          departmentId,
          departmentRole: 'head',
          actingForUserId: null,
          viewAs: req.actor?.viewAs != null,
          ip: requestIp(req),
          userAgent: requestUserAgent(req),
        },
        departmentId,
      )
      const botUsername = resolvedBotUsername()
      const configured = isTelegramConfigured()
      const selfLinked = await getLinkStatus(req.actor!.userId)
      return reply.send({
        botConfigured: configured,
        botUsername,
        miniappUrl: miniappUrl(),
        memberCount: counts.memberCount,
        linkedMemberCount: counts.linkedMemberCount,
        groupCount: counts.groupCount,
        steps: [
          { id: 'bot_token' as const, done: configured, progress: null },
          { id: 'bot_username' as const, done: botUsername !== null, progress: null },
          // "Done" for the checklist means "we can hand the head a URL to paste into BotFather's
          // menu-button dialog"; Telegram does not expose a read API for that setting, so the honest
          // signal is that the app itself is reachable, not a claim we cannot verify.
          { id: 'menu_button' as const, done: configured && botUsername !== null, progress: null },
          { id: 'link_self' as const, done: selfLinked.linked, progress: null },
          {
            id: 'members_linked' as const,
            done: counts.memberCount > 0 && counts.linkedMemberCount === counts.memberCount,
            progress: { done: counts.linkedMemberCount, total: counts.memberCount },
          },
          { id: 'group_connected' as const, done: counts.groupCount > 0, progress: null },
        ],
      })
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
      schema: {
        params: webhookParamsSchema,
        body: z.record(z.string(), z.unknown()),
      },
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
      if (
        pendingUpdates.size >= 120 ||
        (typeof updateId === 'number' && pendingUpdates.has(updateId))
      ) {
        return reply.code(503).send({ ok: false })
      }
      if (typeof updateId !== 'number' || !replayWindow.accept(updateId)) {
        reply.code(200).send({ ok: true })
        return
      }
      pendingUpdates.add(updateId)
      try {
        await current.handleUpdate(req.body as unknown as Update)
      } catch {
        replayWindow.release(updateId)
        req.log.error({}, 'telegram: webhook update handling failed; delivery will be retried')
        return reply.code(503).send({ ok: false })
      } finally {
        pendingUpdates.delete(updateId)
      }
      return reply.code(200).send({ ok: true })
    },
  )

  // --- Boot-time wiring: webhook registration in production, long-polling fallback in dev ------------

  app.addHook('onReady', async () => {
    if (!isTelegramConfigured() || app.devonConfig.NODE_ENV === 'test') return
    if (app.devonConfig.NODE_ENV !== 'production' && !app.devonConfig.TELEGRAM_POLLING_ENABLED) {
      app.log.info({}, 'telegram: development polling disabled; production webhook left untouched')
      return
    }
    const activeBot = getBot()
    if (!activeBot) return
    try {
      await activeBot.init()
    } catch {
      app.log.warn(
        {},
        'telegram: bot.init() failed (no network to Telegram, or an invalid token) -- staying in no-op mode',
      )
      if (
        app.devonConfig.TELEGRAM_TRANSPORT === 'polling' ||
        app.devonConfig.NODE_ENV !== 'production'
      ) {
        pollingHandle = startTelegramPolling(activeBot, app.devonConfig, app.log)
      }
      return
    }

    // Make the existing commands and Mini App discoverable in Telegram itself. People should
    // not need to remember /help or ask an operator to finish a separate BotFather setup.
    try {
      const commands = (locale: BotLocale) => [
        { command: 'app', description: tb(locale, 'miniapp.open') },
        { command: 'help', description: tb(locale, 'command.help') },
        { command: 'today', description: tb(locale, 'today.header') },
        { command: 'mytasks', description: tb(locale, 'miniapp.open_inbox') },
        { command: 'events', description: tb(locale, 'miniapp.open_events') },
        { command: 'mute', description: tb(locale, 'command.mute') },
      ]
      await Promise.all([
        activeBot.api.setMyCommands(commands('uz-Latn')),
        activeBot.api.setMyCommands(commands('ru'), { language_code: 'ru' }),
        activeBot.api.setMyCommands(commands('en'), { language_code: 'en' }),
      ])
      const url = miniappUrl()
      if (url.startsWith('https://')) {
        await activeBot.api.setChatMenuButton({
          menu_button: { type: 'web_app', text: 'Devon', web_app: { url } },
        })
      }
    } catch {
      app.log.warn({}, 'telegram: command/menu setup failed; existing commands remain usable')
    }

    const secret = readWebhookSecret(app)
    if (
      app.devonConfig.NODE_ENV === 'production' &&
      app.devonConfig.TELEGRAM_TRANSPORT === 'webhook' &&
      secret
    ) {
      const baseUrl = app.devonConfig.TELEGRAM_WEBHOOK_BASE_URL ?? publicUrl()
      const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/telegram/webhook/${secret}`
      try {
        await activeBot.api.setWebhook(
          url,
          await webhookOptions(secret, app.devonConfig.TELEGRAM_WEBHOOK_CERTIFICATE_PATH),
        )
        // H1.11/H1.1: the URL contains the webhook secret -- logging it (as this line used to)
        // wrote a live credential into every log sink and every backup of them. The path is a
        // constant plus that secret, so there is nothing left worth logging but the fact.
        app.log.info({}, 'telegram: webhook registered')
      } catch {
        app.log.warn(
          {},
          'telegram: setWebhook failed; inbound delivery is unavailable until webhook registration succeeds',
        )
        // Starting grammY polling deletes the configured webhook. A failed registration must
        // never silently steal another instance's deliveries or change production transport.
      }
    } else {
      pollingHandle = startTelegramPolling(activeBot, app.devonConfig, app.log)
    }
  })

  app.addHook('onClose', async () => {
    if (pollingHandle) await pollingHandle.stop().catch(() => {})
  })
}

export default telegramRoutes
export const prefix = ''

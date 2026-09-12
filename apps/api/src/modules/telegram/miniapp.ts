// The Telegram Mini App's server side (v1.1 SPEC §9, EPIC-015). Registered by this module's
// `index.ts` at `/api/v1/telegram/miniapp`.
//
// ## How a Mini App signs in
//
// Telegram opens `https://<DEVON_PUBLIC_URL>/miniapp/` inside its own webview and hands the page a
// signed query string (`window.Telegram.WebApp.initData`). The page posts it once to
// `POST /api/v1/telegram/miniapp/session` in the `X-Telegram-Init-Data` header. This module verifies
// the HMAC against the bot token (`miniapp-initdata.ts` -- pure, unit-tested), looks up which Devon
// account that Telegram chat is linked to (`/start <code>` in the bot, exactly as before), and mints
// an ordinary Devon session: the same `app.sessions` row, the same `devon_sid` + `devon_csrf`
// cookies, the same audit trail that `POST /auth/login` writes.
//
// That last decision is the important one. **The Mini App is a thin client over the existing API**:
// once the cookie is set, its inbox is `GET /api/v1/notifications`, its card is
// `PATCH /api/v1/cards/:id`, its RSVP is `POST /api/v1/events/:id/rsvp`, its Pomodoro is
// `POST /api/v1/personal/pomodoro/sessions`. Not one permission check, audit row or domain event is
// re-implemented for the phone (I-5, I-7, I-14). Only three reads genuinely need a phone-shaped
// endpoint, and they are the three routes below plus the head's setup checklist in `index.ts`.
//
// The cookie is deliberately short-lived (`MINIAPP_COOKIE_SECONDS`): Telegram relaunches the Mini App
// constantly and re-exchanging costs one request, so there is no reason for a Mini App cookie to
// outlive a working day. The session row keeps the product's ordinary 12 h idle / 30 d absolute
// policy on top of that.
//
// ## Running it in a normal browser (documented dev mode)
//
// `initData` can only be produced by Telegram with the live bot token, and this server accepts no
// substitute -- there is no "skip verification" flag, because a flag like that is one misconfigured
// environment away from being an authentication bypass in a government system. The local dev path is
// instead:
//
//   1. `pnpm start --demo`, sign in at `/login` as `demo.xodim` or `demo.boshliq` in the same browser.
//   2. Open the Mini App dev server (`pnpm --filter @devon/miniapp dev`, default `http://127.0.0.1:5199`).
//      Its Vite proxy sends `/api` to the same API, so the `devon_sid` cookie from step 1 is sent too.
//   3. The Mini App's client-side stub (`apps/miniapp/src/lib/telegram.ts`) fills in for
//      `window.Telegram.WebApp` -- theme params, viewport, haptics, `start_param` from `?startapp=` --
//      so every Telegram-specific code path runs, while the *identity* comes from the session cookie
//      you already have. `POST /session` answers `source: "web_session"` in that mode, and the app
//      shows a "Namunaviy rejim" strip so nobody mistakes it for the real thing.
//
// With `TELEGRAM_BOT_TOKEN` set and the bot's menu button pointing at `/miniapp/`, the identical
// build runs the `source: "telegram"` path end to end against the real bot.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { CSRF_COOKIE_NAME, csrfCookieOptions, sessionCookieOptions } from '../../lib/cookies.js'
import { buildActor, departmentRoleOf } from '../../lib/actor.js'
import type { AuditCtx } from '../../types.js'
import { listNotifications } from '../notifications/repo.js'
import { getLinkStatus, resolveUserByChatId } from './repo.js'
import { isTelegramConfigured, publicUrl, sendPlainMessage } from './transport.js'
import { tb, isBotLocale, DEFAULT_BOT_LOCALE, type BotLocale } from './templates.js'
import { verifyInitData, type VerifiedInitData } from './miniapp-initdata.js'
import {
  boardPeek,
  fieldsAvailable,
  listMyPersonFields,
  setMyPersonField,
} from './miniapp-repo.js'
import {
  boardPeekSchema,
  focusAlertBodySchema,
  focusAlertResultSchema,
  miniFieldsSchema,
  miniappIdentitySchema,
  miniappSessionSchema,
  setFieldBodySchema,
} from './miniapp-schemas.js'

/** The header the Mini App puts its `initData` in. A custom header, never a cookie or a query
 * parameter: a cross-site page cannot set one without a CORS preflight this API never grants, which
 * is what makes the exchange itself CSRF-proof, and it never lands in an access log the way a query
 * string would. */
export const INIT_DATA_HEADER = 'x-telegram-init-data'

/** 12 hours. See this file's header. */
const MINIAPP_COOKIE_SECONDS = 12 * 60 * 60

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the route-level `onRequest` hook below when, and only when, a valid `initData` was
     * presented AND that Telegram chat is linked to an active Devon account. Never derived from a
     * cookie -- the two identities are kept apart on purpose (see `resolveSessionIdentity`). */
    miniappInit: { init: VerifiedInitData; userId: string } | null
  }
}

export function miniappUrl(): string {
  return `${publicUrl().replace(/\/+$/, '')}/miniapp/`
}

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

function dbContext(req: FastifyRequest) {
  const departmentId = activeDepartmentId(req) || null
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    departmentId,
    departmentRole: departmentRoleOf(req.actor ?? null, departmentId),
    actingForUserId: null,
    viewAs: req.actor?.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function localeOf(req: FastifyRequest): BotLocale {
  const locale = req.actorUser?.locale
  return isBotLocale(locale) ? locale : DEFAULT_BOT_LOCALE
}

const miniappRoutes: FastifyPluginAsyncZod = async (app) => {
  app.decorateRequest('miniappInit', null)

  /**
   * Resolves an `X-Telegram-Init-Data` header into a linked Devon account, before Fastify's global
   * session/authorize `preHandler`s run (`onRequest` is an earlier phase, so `plugins/session.ts`
   * still gets the last word on `req.actor` when a cookie is also present -- deliberate: the
   * *handler* below decides which identity a session is minted for, and it always prefers the
   * verified Telegram one).
   *
   * Nothing here throws or replies: an absent, malformed, stale or unlinked `initData` simply leaves
   * `req.miniappInit` null, and the route answers from the cookie identity or 401s through `can()`
   * like any other route. Failing closed is the whole shape of this function.
   */
  async function resolveInitData(req: FastifyRequest): Promise<void> {
    const raw = req.headers[INIT_DATA_HEADER]
    const initData = Array.isArray(raw) ? raw[0] : raw
    if (!initData) return

    const result = verifyInitData(initData, app.devonConfig.TELEGRAM_BOT_TOKEN ?? null)
    if (!result.ok) {
      // `warn`, not `error`: a stale launch is an ordinary event, and the reason is a fixed enum,
      // never the payload itself (which carries the user's own Telegram profile).
      req.log.warn({ reason: result.reason }, 'telegram miniapp: initData rejected')
      return
    }

    // In a private chat the Telegram user id *is* the chat id, which is what `/start <code>` stored.
    const linked = await resolveUserByChatId(String(result.data.user.id))
    if (!linked) return

    const user = await app.devon.findUserById(linked.userId)
    if (!user || user.status !== 'active') return

    req.miniappInit = { init: result.data, userId: linked.userId }
    if (!req.actor) {
      const memberships = await app.devon.listActiveMembershipsForUser(linked.userId)
      req.actor = buildActor(user, memberships)
      req.actorUser = user
    }
  }

  async function identityFor(
    req: FastifyRequest,
    userId: string,
    source: 'telegram' | 'web_session',
    startParam: string | null,
  ) {
    const memberships = await app.devon.listActiveMembershipsForUser(userId)
    const user = req.actorUser?.id === userId ? req.actorUser : await app.devon.findUserById(userId)
    const active =
      memberships.find((m) => m.departmentId === activeDepartmentId(req)) ?? memberships[0] ?? null

    const [unread, link, hasFields] = await Promise.all([
      listNotifications(userId, { status: 'unread', limit: 1 }),
      getLinkStatus(userId),
      active ? fieldsAvailable(dbContext(req)) : Promise.resolve(false),
    ])

    return {
      user: {
        id: userId,
        givenName: user?.givenName ?? '',
        familyName: user?.familyName ?? '',
        patronymic: user?.patronymic ?? null,
        title: user?.title ?? null,
        locale: user?.locale ?? DEFAULT_BOT_LOCALE,
        avatarKey: user?.avatarKey ?? null,
      },
      department: active ? { id: active.departmentId, name: active.departmentName } : null,
      departmentRole: active ? active.role : null,
      botUsername: app.devonConfig.TELEGRAM_BOT_USERNAME ?? null,
      telegramLinked: link.linked,
      source,
      startParam,
      unreadCount: unread.unreadCount,
      fieldsAvailable: hasFields,
    }
  }

  // --- 1. Sign in ------------------------------------------------------------------------------------

  app.post(
    '/session',
    {
      onRequest: resolveInitData,
      config: {
        permission: {
          action: 'read',
          // The subject is "this person, about themselves". `req.actor` is either the account the
          // verified `initData` resolved to (set by the hook above) or the browser's existing web
          // session; with neither, `can()` answers `not_authenticated` and this is a 401 -- there is
          // no anonymous path into this route.
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
        // An unauthenticated-ish endpoint that does argon2-free but still real work; Telegram itself
        // never needs more than a handful of launches a minute per person.
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: { response: { 200: miniappSessionSchema } },
    },
    async (req, reply) => {
      const fromTelegram = req.miniappInit
      // Prefer the verified Telegram identity over any cookie that happens to be in the jar: a
      // shared browser (the local dev path) must never let a stale web session decide who the Mini
      // App signed in as.
      const userId = fromTelegram?.userId ?? req.actor?.userId
      if (!userId) return sendProblem(reply, 'unauthenticated')

      if (!fromTelegram) {
        // Dev / web-session mode: no new session is minted, because the caller already holds one.
        // `GET /me` is the canonical source of the CSRF token in that mode; echo the same value so
        // the client has exactly one code path.
        const identity = await identityFor(req, userId, 'web_session', null)
        return reply.send({ ...identity, csrfToken: req.cookies[CSRF_COOKIE_NAME] ?? '' })
      }

      const ctx = auditCtxFromReq(req)
      const session = await app.devon.createSession(
        userId,
        { ip: ctx.ip, userAgent: ctx.userAgent },
        { ...ctx, userId },
      )
      reply.setCookie(
        app.devonConfig.SESSION_COOKIE_NAME,
        session.rawToken,
        sessionCookieOptions(MINIAPP_COOKIE_SECONDS),
      )
      reply.setCookie(CSRF_COOKIE_NAME, session.rawCsrf, csrfCookieOptions(MINIAPP_COOKIE_SECONDS))

      const identity = await identityFor(
        req,
        userId,
        'telegram',
        fromTelegram.init.startParam ?? null,
      )
      return reply.send({ ...identity, csrfToken: session.rawCsrf })
    },
  )

  // --- 2. Who am I (after the cookie exists) ----------------------------------------------------------

  app.get(
    '/bootstrap',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: miniappIdentitySchema } },
    },
    async (req, reply) => {
      const identity = await identityFor(req, req.actor!.userId, 'web_session', null)
      return reply.send({ ...identity, source: req.miniappInit ? 'telegram' : identity.source })
    },
  )

  // --- 3. Board peek --------------------------------------------------------------------------------

  app.get(
    '/board-peek',
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
      schema: { response: { 200: boardPeekSchema } },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      const peek = await boardPeek(
        dbContext(req),
        departmentId,
        req.actor!.userId,
        departmentRoleOf(req.actor, departmentId) === 'head',
      )
      return reply.send(peek)
    },
  )

  // --- 4. My person fields (SPEC §5 notify-to-fill lands here) ---------------------------------------

  app.get(
    '/fields',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({
            kind: 'owned' as const,
            departmentId: activeDepartmentId(r),
            ownerUserIds: [r.actor?.userId ?? ''],
          }),
        },
      },
      schema: { response: { 200: miniFieldsSchema } },
    },
    async (req, reply) => {
      const result = await listMyPersonFields(
        dbContext(req),
        activeDepartmentId(req),
        req.actor!.userId,
      )
      return reply.send(result.available ? result : { available: false, items: [] })
    },
  )

  app.put(
    '/fields/:defId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'owned' as const,
            departmentId: activeDepartmentId(r),
            ownerUserIds: [r.actor?.userId ?? ''],
          }),
        },
      },
      schema: {
        params: z.object({ defId: z.string().uuid() }),
        body: setFieldBodySchema,
        response: { 200: miniFieldsSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = activeDepartmentId(req)
      const outcome = await setMyPersonField(
        dbContext(req),
        departmentId,
        req.actor!.userId,
        req.params.defId,
        req.body.value,
      )
      if (outcome === 'unavailable') return sendProblem(reply, 'not_found')
      if (outcome === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome === 'not_self_editable') return sendProblem(reply, 'forbidden')
      const result = await listMyPersonFields(dbContext(req), departmentId, req.actor!.userId)
      return reply.send(result.available ? result : { available: false, items: [] })
    },
  )

  // --- 5. Pomodoro companion: the bot tells you the focus block is over ------------------------------

  app.post(
    '/focus-alert',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal' as const, ownerUserId: r.actor?.userId ?? '' }),
        },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { body: focusAlertBodySchema, response: { 200: focusAlertResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      // I-14 says no *feature* sends Telegram directly -- it goes through the notification pipeline's
      // channel adapters. This **is** the Telegram channel adapter's own module, and the message is a
      // person pinging themselves about a timer they started ten seconds ago on this very screen:
      // routing it through the outbox would add a two-second poll to a "your 25 minutes are up"
      // alert and would be filtered by the recipient's own digest preferences, which is exactly the
      // wrong behaviour for a timer. Nothing about the personal workspace's *content* is sent (I-1):
      // the message names the phase and the length, never a task title.
      if (!isTelegramConfigured()) return reply.send({ sent: false, reason: 'not_configured' })
      const status = await getLinkStatus(req.actor!.userId)
      if (!status.linked || !status.chatId) {
        return reply.send({ sent: false, reason: 'not_linked' })
      }
      if (status.mutedUntil && status.mutedUntil.getTime() > Date.now()) {
        return reply.send({ sent: false, reason: 'muted' })
      }
      const locale = localeOf(req)
      const key =
        req.body.kind === 'focus' ? 'miniapp.focus_done' : 'miniapp.break_done'
      const sendResult = await sendPlainMessage(
        status.chatId,
        tb(locale, key, { minutes: req.body.minutes }),
      )
      return reply.send({
        sent: sendResult.ok,
        reason: sendResult.ok ? 'ok' : 'failed',
      })
    },
  )
}

export default miniappRoutes

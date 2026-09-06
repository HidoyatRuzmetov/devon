// /api/v1/accounts/* -- EPIC-001 (registration, sessions/devices, 2FA, password reset/change, account
// deletion). `POST /register` and `POST /2fa/login-verify` are the two public routes this module adds
// (registered in `plugins/authorize.ts`'s `PUBLIC_ROUTES`, MODULE-GUIDE.md's one sanctioned
// public-route edit); everything else is `own_account` (or, for the admin reset, `instance`).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { sendProblem } from '../../lib/problem-reply.js'
import { checkCsrf } from '../../lib/csrf.js'
import {
  CSRF_COOKIE_NAME,
  csrfCookieOptions,
  expiredSessionCookieOptions,
  sessionCookieOptions,
} from '../../lib/cookies.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import * as repo from './repo.js'
import {
  changePasswordBodySchema,
  deleteAccountResultSchema,
  registerBodySchema,
  registerResultSchema,
  resetPasswordResultSchema,
  sessionIdParamsSchema,
  sessionListSchema,
  toAccountPublicUser,
  totpDisableBodySchema,
  totpEnrollResultSchema,
  totpVerifyBodySchema,
  totpVerifyResultSchema,
  twoFaLoginVerifyBodySchema,
  userIdParamsSchema,
  accountStatusMessageSchema,
} from './schemas.js'

const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60

const accountsRoutes: FastifyPluginAsyncZod = async (app) => {
  const ownAccount = (userId: string) => ({ kind: 'own_account' as const, userId })

  function auditCtx(req: FastifyRequest) {
    return {
      requestId: req.id,
      userId: req.actor?.userId ?? null,
      actorRole: req.actor?.role ?? null,
      actingForUserId: null,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    }
  }

  async function startSession(userId: string, req: FastifyRequest, reply: FastifyReply) {
    const session = await app.devon.createSession(
      userId,
      { ip: requestIp(req), userAgent: requestUserAgent(req) },
      auditCtx(req),
    )
    reply.setCookie(
      app.devonConfig.SESSION_COOKIE_NAME,
      session.rawToken,
      sessionCookieOptions(SESSION_ABSOLUTE_SECONDS),
    )
    reply.setCookie(CSRF_COOKIE_NAME, session.rawCsrf, csrfCookieOptions(SESSION_ABSOLUTE_SECONDS))
  }

  app.post(
    '/register',
    {
      config: {
        permission: { public: true },
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: { body: registerBodySchema, response: { 201: registerResultSchema } },
    },
    async (req, reply) => {
      let user
      try {
        user = await repo.registerUser(req.body, auditCtx(req))
      } catch (err) {
        if (err instanceof repo.LoginTaken) {
          sendProblem(reply, 'conflict')
          return
        }
        throw err
      }
      await startSession(user.id, req, reply)
      reply.code(201).send({ user: toAccountPublicUser(user), csrfToken: req.cookies[CSRF_COOKIE_NAME] ?? '' })
    },
  )

  app.get(
    '/sessions',
    {
      config: { permission: { action: 'read', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: sessionListSchema } },
    },
    async (req, reply) => {
      const sessions = await repo.listSessions(req.actor!.userId)
      reply.send({
        sessions: sessions.map((s) => ({
          id: s.id,
          deviceLabel: s.deviceLabel,
          ip: s.ip,
          userAgent: s.userAgent,
          createdAt: s.createdAt.toISOString(),
          lastSeenAt: s.lastSeenAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          isCurrent: s.id === req.sessionId,
        })),
      })
    },
  )

  app.post(
    '/sessions/:id/revoke',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { params: sessionIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { id } = req.params
      const ok = await repo.revokeOwnSession(req.actor!.userId, id, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/sessions/revoke-all',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.revokeAllSessions(req.actor!.userId, auditCtx(req))
      reply.setCookie(app.devonConfig.SESSION_COOKIE_NAME, '', expiredSessionCookieOptions())
      reply.setCookie(CSRF_COOKIE_NAME, '', { ...expiredSessionCookieOptions(), httpOnly: false })
      reply.code(204).send()
    },
  )

  app.get(
    '/2fa',
    {
      config: { permission: { action: 'read', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: accountStatusMessageSchema } },
    },
    async (req, reply) => {
      const status = await repo.getTwoFactorStatus(req.actor!.userId)
      reply.send({ ok: status.enabled })
    },
  )

  app.post(
    '/2fa/totp/enroll',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: totpEnrollResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.enrollTotp(
        req.actor!.userId,
        req.actorUser!.login,
        app.devonConfig.CSRF_SECRET,
      )
      reply.send(result)
    },
  )

  app.post(
    '/2fa/totp/verify',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { body: totpVerifyBodySchema, response: { 200: totpVerifyResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.verifyTotpEnroll(
        req.actor!.userId,
        req.body.code,
        app.devonConfig.CSRF_SECRET,
        auditCtx(req),
      )
      if (!result.ok) {
        sendProblem(reply, 'validation_failed', { errors: [{ path: 'code', code: 'invalid' }] })
        return
      }
      reply.send({ recoveryCodes: result.recoveryCodes })
    },
  )

  app.post(
    '/2fa/disable',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { body: totpDisableBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.disableTotp(req.actor!.userId, req.body.password, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'forbidden')
        return
      }
      reply.code(204).send()
    },
  )

  // Public: the second step of login when 2FA is enabled (`POST /auth/login` returned
  // `{ requires2fa: true, challengeToken }` instead of a session -- see `modules/auth/index.ts`).
  app.post(
    '/2fa/login-verify',
    {
      config: {
        permission: { public: true },
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: { body: twoFaLoginVerifyBodySchema },
    },
    async (req, reply) => {
      const result = await repo.consumeLoginChallenge(
        req.body.challengeToken,
        req.body.code,
        app.devonConfig.CSRF_SECRET,
      )
      if (!result.ok) {
        sendProblem(reply, result.reason === 'locked' ? 'rate_limited' : 'unauthenticated')
        return
      }
      await startSession(result.userId, req, reply)
      reply.code(204).send()
    },
  )

  app.post(
    '/password/change',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { body: changePasswordBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.changePassword(
        req.actor!.userId,
        req.body.currentPassword,
        req.body.newPassword,
        auditCtx(req),
      )
      if (!ok) {
        sendProblem(reply, 'forbidden')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/:userId/reset-password',
    {
      config: { permission: { action: 'administer', subject: () => ({ kind: 'instance' as const }) } },
      schema: { params: userIdParamsSchema, response: { 200: resetPasswordResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { userId } = req.params
      const temporaryPassword = await repo.adminResetPassword(userId, auditCtx(req))
      reply.send({ temporaryPassword })
    },
  )

  app.post(
    '/delete',
    {
      config: { permission: { action: 'delete', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: deleteAccountResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const scheduledFor = await repo.requestAccountDeletion(req.actor!.userId, auditCtx(req))
      reply.send({ scheduledFor: scheduledFor.toISOString() })
    },
  )

  app.post(
    '/delete/cancel',
    {
      config: { permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.cancelAccountDeletion(req.actor!.userId, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.get(
    '/delete/status',
    {
      config: { permission: { action: 'read', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: deleteAccountResultSchema.nullable() } },
    },
    async (req, reply) => {
      const scheduledFor = await repo.getPendingDeletion(req.actor!.userId)
      reply.send(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : null)
    },
  )
}

export default accountsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/accounts`.
export const prefix = '/accounts'

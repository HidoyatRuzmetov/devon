// /api/v1/accounts/* -- EPIC-001 (registration, sessions/devices, 2FA, password reset/change, account
// deletion, profile photo). `POST /register` and `POST /2fa/login-verify` are the two public routes
// this module adds (registered in `plugins/authorize.ts`'s `PUBLIC_ROUTES`, MODULE-GUIDE.md's one
// sanctioned public-route edit); everything else is `own_account` (or, for the admin reset,
// `instance`).
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
import { avatarKeyPrefix, avatarVariantKey } from '../../lib/storage/object-store.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { LoginThrottle, loginThrottle } from '../../lib/login-throttle.js'
import * as repo from './repo.js'
import { finalizeAvatar, removeAvatar, requestAvatarUpload } from './avatar-service.js'
import {
  avatarFinalizeBodySchema,
  avatarImageParamsSchema,
  avatarResultSchema,
  avatarUploadUrlBodySchema,
  avatarUploadUrlResultSchema,
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

/** A served avatar variant is at most a few tens of KB; this is a sanity ceiling, not a budget. */
const AVATAR_VARIANT_MAX_BYTES = 2 * 1024 * 1024

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

  /** Returns the created session so a handler that needs the raw CSRF token in its *response body*
   * (`POST /register`) can send the real one: `req.cookies` only ever holds what the client sent, never
   * a cookie this same reply is setting. */
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
    return session
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
      const session = await startSession(user.id, req, reply)
      // The raw CSRF token from the session just created -- NOT `req.cookies[...]`, which is empty on
      // the very request that sets the cookie (found live: the post-registration photo upload was
      // 403ing on its first CSRF-checked call because the body carried an empty token).
      reply.code(201).send({ user: toAccountPublicUser(user), csrfToken: session.rawCsrf })
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
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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
      // H1.9: the same progressive lockout the password step uses, keyed on the challenge token so
      // a stolen challenge cannot be used to grind six digits. `consumeLoginChallenge` has its own
      // per-challenge attempt cap; this adds the cross-request, time-widening half.
      const throttleKey = LoginThrottle.key(
        '2fa',
        req.body.challengeToken.slice(0, 32),
        requestIp(req),
      )
      const throttled = loginThrottle.check(throttleKey)
      if (throttled.locked) {
        reply.header('retry-after', String(throttled.retryAfterSeconds))
        sendProblem(reply, 'rate_limited')
        return
      }
      const result = await repo.consumeLoginChallenge(
        req.body.challengeToken,
        req.body.code,
        app.devonConfig.CSRF_SECRET,
      )
      if (!result.ok) {
        loginThrottle.recordFailure(throttleKey)
        sendProblem(reply, result.reason === 'locked' ? 'rate_limited' : 'unauthenticated')
        return
      }
      loginThrottle.recordSuccess(throttleKey)
      await startSession(result.userId, req, reply)
      reply.code(204).send()
    },
  )

  app.post(
    '/password/change',
    {
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
        // H1.9: verifies `currentPassword`, so it is a credential-guessing surface like login.
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
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
      config: {
        permission: { action: 'administer', subject: () => ({ kind: 'instance' as const }) },
        // H1.9: mints a temporary password; bounded even for a super admin.
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
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
      config: {
        permission: { action: 'delete', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
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

  // --- Profile photo (TECH-SPEC §2.1: "presigned upload, ClamAV, 512 px WebP variants") ----------
  // Three-step flow, see `avatar-service.ts`: (1) `POST /avatar/upload-url` hands the browser a
  // presigned PUT; (2) the browser uploads straight to it (MinIO, or the local driver's own route);
  // (3) `POST /avatar` scans, validates, resizes and only then writes `users.avatar_key`.

  app.post(
    '/avatar/upload-url',
    {
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { body: avatarUploadUrlBodySchema, response: { 200: avatarUploadUrlResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (req.body.size > app.storage.maxUploadBytes) {
        sendProblem(reply, 'validation_failed', { errors: [{ path: 'size', code: 'too_large' }] })
        return
      }
      const { upload, presigned } = await requestAvatarUpload(
        app,
        req.actor!.userId,
        req.body,
        auditCtx(req),
      )
      reply.send({
        uploadId: upload.id,
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
        expiresAt: presigned.expiresAt.toISOString(),
      })
    },
  )

  app.post(
    '/avatar',
    {
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { body: avatarFinalizeBodySchema, response: { 200: avatarResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await finalizeAvatar(app, req.actorUser!, req.body.uploadId, auditCtx(req))
      if (result.ok) {
        reply.send({ user: toAccountPublicUser(result.user) })
        return
      }
      switch (result.reason) {
        case 'not_found':
          sendProblem(reply, 'not_found')
          return
        case 'consumed':
        case 'not_uploaded':
          sendProblem(reply, 'conflict')
          return
        case 'expired':
          sendProblem(reply, 'gone')
          return
        case 'rejected':
          sendProblem(reply, 'validation_failed', { errors: [{ path: 'file', code: result.code }] })
          return
        case 'infected':
          // The signature name stays in the audit row and the server log; a Problem body carries
          // fixed sentences and machine codes only (design.md §1.5).
          sendProblem(reply, 'validation_failed', { errors: [{ path: 'file', code: 'infected' }] })
          return
        case 'scanner_unavailable':
          // 503: the scanner is down and the upload was discarded rather than let through unscanned
          // (H8.1). The client shows "try again later", never "your photo is saved".
          sendProblem(reply, 'maintenance')
          return
      }
    },
  )

  app.delete(
    '/avatar',
    {
      config: {
        permission: { action: 'update', subject: (r) => ownAccount(r.actor?.userId ?? '') },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await removeAvatar(app, req.actorUser!, auditCtx(req))
      reply.code(204).send()
    },
  )

  // Any signed-in user may see any user's photo: it is `public`-tier profile data within the
  // instance, exactly like the name it sits beside (design.md §3.2). v1.1 added `{kind:'authenticated'}`
  // to `can()` so that statement is the subject itself (PERMISSIONS-AUDIT D11).
  // Content-addressed by upload id (a new photo is always a new URL), so the variant is immutable and
  // cacheable for a day; no database read happens here at all.
  app.get(
    '/avatar/:userId/:uploadId/:size',
    {
      config: {
        // D11, fixed. This used to declare `{kind:'own_account', userId: <the requester's own id>}`,
        // which is a tautology: it reads like an owner check on the path's `:userId` and is in fact
        // "any authenticated session". The behaviour is right -- a colleague's avatar is deliberately
        // visible to the whole team, and per-request department resolution for a 64x64 PNG would be
        // absurd -- so the subject now says that out loud instead of pretending to be stricter.
        permission: { action: 'read', subject: () => ({ kind: 'authenticated' as const }) },
      },
      schema: { params: avatarImageParamsSchema },
    },
    async (req, reply) => {
      const { userId, uploadId, size } = req.params
      const key = avatarVariantKey(avatarKeyPrefix(userId, uploadId), Number(size))
      const bytes = await app.storage.store.get(key, { maxBytes: AVATAR_VARIANT_MAX_BYTES })
      if (!bytes) {
        sendProblem(reply, 'not_found')
        return
      }
      reply
        .header('content-type', 'image/webp')
        .header('content-length', bytes.length)
        .header('cache-control', 'private, max-age=86400, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(bytes)
    },
  )
}

export default accountsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/accounts`.
export const prefix = '/accounts'

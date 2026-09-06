// POST /api/v1/auth/login (public, rate-limited) and POST /api/v1/auth/logout (authenticated) --
// design.md §1.7, AC-13.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { loginBodySchema } from '../../schemas.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import {
  CSRF_COOKIE_NAME,
  csrfCookieOptions,
  expiredSessionCookieOptions,
  sessionCookieOptions,
} from '../../lib/cookies.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'

const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60

// Never returned by `findUserByLogin` for a real account -- used only so a login attempt against a
// nonexistent login takes roughly the same time as one against a real, wrong password (no account
// enumeration via timing, TECH-SPEC §2.1).
let dummyHash: string | null = null
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword('no-such-account-placeholder-value')
  return dummyHash
}

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/login',
    {
      config: {
        permission: { public: true },
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: { body: loginBodySchema },
    },
    async (req, reply) => {
      const { login, password } = req.body
      const user = await app.devon.findUserByLogin(login)
      const passwordOk = await verifyPassword(
        user?.passwordHash ?? (await getDummyHash()),
        password,
      )

      if (!user || !passwordOk || user.status !== 'active') {
        sendProblem(reply, 'unauthenticated')
        return
      }

      const ctx = {
        requestId: req.id,
        userId: user.id,
        actorRole: user.role,
        actingForUserId: null,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
      }
      const session = await app.devon.createSession(
        user.id,
        { ip: ctx.ip, userAgent: ctx.userAgent },
        ctx,
      )

      reply.setCookie(
        app.devonConfig.SESSION_COOKIE_NAME,
        session.rawToken,
        sessionCookieOptions(SESSION_ABSOLUTE_SECONDS),
      )
      reply.setCookie(
        CSRF_COOKIE_NAME,
        session.rawCsrf,
        csrfCookieOptions(SESSION_ABSOLUTE_SECONDS),
      )
      reply.code(204).send()
    },
  )

  app.post(
    '/logout',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'own_account', userId: r.actor?.userId ?? '' }),
        },
      },
    },
    async (req, reply) => {
      if (req.sessionId) {
        await app.devon.revokeSession(req.sessionId, 'logout', {
          requestId: req.id,
          userId: req.actor!.userId,
          actorRole: req.actor!.role,
          actingForUserId: null,
          ip: requestIp(req),
          userAgent: requestUserAgent(req),
        })
      }
      reply.setCookie(app.devonConfig.SESSION_COOKIE_NAME, '', expiredSessionCookieOptions())
      reply.setCookie(CSRF_COOKIE_NAME, '', { ...expiredSessionCookieOptions(), httpOnly: false })
      reply.code(204).send()
    },
  )
}

export default authRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/auth`.
export const prefix = '/auth'

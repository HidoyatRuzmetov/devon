// The single permission preHandler (design.md §1.6, §3.4; I-6, I-7). Every route declares
// `config.permission`; a route registered without it throws at registration time (`onRoute`, H7.3) --
// fail fast at boot, never at request time. `denyForSubject` is exported so `src/modules/admin.ts` can
// call the exact same code path from its scoped `notFoundHandler`, which is how the design's
// byte-identical-403 requirement for `/api/v1/admin/*` (matched vs unmatched) is actually satisfied:
// two different call sites, one function, one Problem body.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { can, type Action, type Subject } from '@devon/contracts'
import { sendProblem } from '../lib/problem-reply.js'
import { requestIp, requestUserAgent } from './session.js'

declare module 'fastify' {
  interface FastifyContextConfig {
    permission: { action: Action; subject: (req: FastifyRequest) => Subject } | { public: true }
  }
  interface FastifyInstance {
    /** Populated by this plugin's `onRoute` hook, one entry per route actually registered with
     * `{ public: true }` -- this is what `test/unit/public-routes.test.ts` walks to prove
     * `PUBLIC_ROUTES` (design.md §1.7/§3.4) is exactly right, rather than trusting the constant alone. */
    publicRoutes: { method: string; url: string }[]
  }
}

/** Checked-in allow-list (design.md §1.7/§3.4). A unit test (`test/unit/public-routes.test.ts`) asserts
 * this equals the set of routes actually registered with `{ public: true }` -- so adding a public
 * route is a visible diff here, and forgetting `can()` anywhere else is impossible (a missing
 * `permission` key throws at boot, see `registerBootGuard` below). */
export const PUBLIC_ROUTES: ReadonlyArray<{ method: string; url: string }> = Object.freeze([
  { method: 'GET', url: '/healthz' },
  { method: 'GET', url: '/readyz' },
  { method: 'GET', url: '/api/v1/openapi.json' },
  { method: 'GET', url: '/api/v1/instance' },
  { method: 'POST', url: '/api/v1/setup/:token' },
  { method: 'POST', url: '/api/v1/auth/login' },
  // EPIC-001: a fresh visitor has no session yet by definition.
  { method: 'POST', url: '/api/v1/accounts/register' },
  // EPIC-001: the second step of a 2FA-protected login -- also pre-session by definition (see
  // `modules/accounts/index.ts`'s header comment).
  { method: 'POST', url: '/api/v1/accounts/2fa/login-verify' },
  // EPIC-002: the `/join/:key` landing page needs the department's name before the visitor has signed
  // in at all (TECH-SPEC §2.2: "if logged out, register/login first, then the password prompt") --
  // this preview never returns anything sensitive (no join password, no member list).
  { method: 'GET', url: '/api/v1/departments/join/:key' },
])

/**
 * Runs `can()` for `(action, subject)` against `req.actor` (resolved by `plugins/session.ts`). On
 * deny, sends the Problem and -- for an authenticated actor only (P6, "Denial-audit DoS" design.md
 * §3.4) -- writes `audit.events{action:'access.denied'}`. Returns `true` when the caller may proceed.
 */
export async function denyForSubject(
  req: FastifyRequest,
  reply: FastifyReply,
  action: Action,
  subject: Subject,
): Promise<boolean> {
  const decision = can(req.actor, action, subject)
  if (decision.allowed) return true

  if (decision.reason === 'not_authenticated') {
    sendProblem(reply, 'unauthenticated')
    return false
  }

  // Every other deny reason is a 403. Deliberately no `instance` (request id) field on this Problem:
  // design.md §3.4 requires the 403 body for an existing admin route and for an unmatched one to be
  // byte-identical, which a per-request id would break.
  sendProblem(reply, 'forbidden')

  if (req.actor) {
    await (req.server as FastifyInstance).devon.recordAccessDenied(
      {
        requestId: req.id,
        userId: req.actor.userId,
        actorRole: req.actor.role,
        actingForUserId: null,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
      },
      { route: `${req.method} ${req.routeOptions.url ?? req.url}`, reason: decision.reason },
    )
  }
  return false
}

export default fp(async function authorizePlugin(app: FastifyInstance) {
  app.decorate('publicRoutes', [])

  app.addHook('onRoute', (routeOptions) => {
    const config = routeOptions.config as { permission?: { public?: true } } | undefined
    if (!config || !('permission' in config) || config.permission === undefined) {
      throw new Error(
        `Route ${routeOptions.method as string} ${routeOptions.url} is missing config.permission ` +
          `(design.md §1.6: every route declares { action, subject } or { public: true }, or the ` +
          `server refuses to boot).`,
      )
    }
    if (config.permission.public) {
      const methods = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method]
      for (const method of methods) {
        app.publicRoutes.push({ method: method as string, url: routeOptions.url })
      }
    }
  })

  app.addHook('preHandler', async (req, reply) => {
    // Fastify runs the global `preHandler` chain ahead of a 404 too (no matched route -> no
    // `config`), so an admin-scoped `setNotFoundHandler` can call `denyForSubject` itself (see
    // `src/modules/admin.ts`) instead of this hook ever seeing a permission for it.
    const permission = req.routeOptions.config?.permission
    if (!permission) return
    if ('public' in permission && permission.public) return
    if ('action' in permission) {
      await denyForSubject(req, reply, permission.action, permission.subject(req))
    }
  })
})

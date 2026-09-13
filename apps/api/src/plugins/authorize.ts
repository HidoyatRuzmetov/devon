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
    /** v1.1 SPEC §2 (PERMISSIONS-AUDIT Step 1.4): one entry per authenticated route, carrying the
     * subject **kind** its declaration resolves to. `test/unit/head-only-routes.test.ts` walks this
     * and compares it with a checked-in allow-list, so moving a route onto (or off) the head-only
     * subject is a visible diff in a test file -- the same mechanism `PUBLIC_ROUTES` already gives
     * for public routes, applied to the other end of the matrix. */
    routePermissions: {
      method: string
      url: string
      action: Action
      subjectKind: string
    }[]
  }
}

/** Checked-in allow-list (design.md §1.7/§3.4). A unit test (`test/unit/public-routes.test.ts`) asserts
 * this equals the set of routes actually registered with `{ public: true }` -- so adding a public
 * route is a visible diff here, and forgetting `can()` anywhere else is impossible (a missing
 * `permission` key throws at boot, see `registerBootGuard` below). */
export const PUBLIC_ROUTES: ReadonlyArray<{ method: string; url: string }> = Object.freeze([
  { method: 'GET', url: '/healthz' },
  { method: 'GET', url: '/readyz' },
  // H15.1: Prometheus scrape endpoint (`modules/metrics.ts`) -- `{public:true}` bypasses the
  // session-based `can()` check the same way `/healthz`/`/readyz` do, but the handler enforces its
  // OWN loopback-only gate (`DEVON_METRICS_REMOTE`), exactly like `/api/v1/setup/:token` below.
  { method: 'GET', url: '/metrics' },
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
  // notifications module (MODULE-GUIDE.md "API modules": public routes are the one intentional
  // shared-file edit): a calendar app's "subscribe by URL" feature carries no session cookie, and
  // Telegram's webhook likewise calls this API with no cookie -- both routes verify their own
  // per-request secret instead (an HMAC-signed token, and a configured webhook path secret).
  { method: 'GET', url: '/api/v1/notifications/ics/:userId/:token' },
  { method: 'POST', url: '/api/v1/telegram/webhook/:secret' },
  // v1.1 SPEC §2.2 / WALKTHROUGH-FINDINGS §2.5: "Parolni tiklashni soʻrash" on the login screen. A
  // person who has forgotten their password has no session by definition. The handler answers 202
  // whatever it finds (never an account-existence oracle), is rate limited per IP, and dedupes to
  // one open request per person per day; the only effect it can have is an inbox item for the head.
  { method: 'POST', url: '/api/v1/accounts/password-reset-request' },
  // v1.1 SPEC §10 / EPIC-019 calendar module. A calendar application -- Google Calendar's "from
  // URL", Outlook's "subscribe from web", Apple Calendar, Thunderbird, DAVx5 -- carries no session
  // cookie and never will; the URL secret IS the credential. Every one of these routes resolves a
  // 256-bit CSPRNG secret through `app.calendar_feed_resolve` and answers a bare 404 for an unknown,
  // rotated or revoked one (no oracle), and every one of them is read-only: the two write verbs
  // below exist only so a write-capable CalDAV client is told "read-only calendar" instead of
  // "server broken".
  { method: 'GET', url: '/api/v1/calendar/feed/:secret' },
  { method: 'OPTIONS', url: '/api/v1/caldav/*' },
  { method: 'PROPFIND', url: '/api/v1/caldav/:secret/' },
  { method: 'PROPFIND', url: '/api/v1/caldav/:secret/calendar/' },
  { method: 'REPORT', url: '/api/v1/caldav/:secret/calendar/' },
  { method: 'GET', url: '/api/v1/caldav/:secret/calendar/:resource' },
  { method: 'PUT', url: '/api/v1/caldav/:secret/calendar/' },
  { method: 'PUT', url: '/api/v1/caldav/:secret/calendar/:resource' },
  { method: 'DELETE', url: '/api/v1/caldav/:secret/calendar/' },
  { method: 'DELETE', url: '/api/v1/caldav/:secret/calendar/:resource' },
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
      {
        route: `${req.method} ${req.routeOptions.url ?? req.url}`,
        reason: decision.reason,
      },
    )
  }
  return false
}

/** Resolves a route's declared subject kind at registration time by calling its `subject()` builder
 * with a minimal stub request. Every builder in this codebase reads only `req.params` and
 * `req.actor` (both present here), so this is exact rather than a guess -- and anything that throws
 * is recorded as `'unknown'` instead of breaking boot, because this table is diagnostics, never a
 * permission decision. */
function resolveSubjectKind(subject: (req: FastifyRequest) => Subject): string {
  try {
    const stub = {
      params: {},
      query: {},
      actor: null,
      headers: {},
      cookies: {},
    }
    return subject(stub as unknown as FastifyRequest).kind
  } catch {
    return 'unknown'
  }
}

export default fp(async function authorizePlugin(app: FastifyInstance) {
  app.decorate('publicRoutes', [])
  app.decorate('routePermissions', [])

  app.addHook('onRoute', (routeOptions) => {
    const config = routeOptions.config as
      | {
          permission?: {
            public?: true
            action?: Action
            subject?: (req: FastifyRequest) => Subject
          }
        }
      | undefined
    if (!config || !('permission' in config) || config.permission === undefined) {
      throw new Error(
        `Route ${routeOptions.method as string} ${routeOptions.url} is missing config.permission ` +
          `(design.md §1.6: every route declares { action, subject } or { public: true }, or the ` +
          `server refuses to boot).`,
      )
    }
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method]
    if (config.permission.public) {
      for (const method of methods) {
        app.publicRoutes.push({
          method: method as string,
          url: routeOptions.url,
        })
      }
      return
    }
    const declared = config.permission as {
      action: Action
      subject: (req: FastifyRequest) => Subject
    }
    const subjectKind = resolveSubjectKind(declared.subject)
    for (const method of methods) {
      app.routePermissions.push({
        method: method as string,
        url: routeOptions.url,
        action: declared.action,
        subjectKind,
      })
    }
  })

  /**
   * `preValidation`, not `preHandler`: **refuse first, then read the body.**
   *
   * Found live in the v1.1 integration walk, hitting every head-only route as `demo.xodim`. The
   * permission check ran after schema validation, so a xodim POSTing `{}` to `/admin/wipe/start` got
   * back `422 {"errors":[{"path":"/phrase"},{"path":"/password"}]}` -- the field names of the wipe
   * switch, handed to someone who may not touch it -- and the same for `/automations/pause-all`,
   * `/fields/defs`, `/people/views` and `PUT /departments/:id/features`. The action was never
   * performed (a valid body answered 403), so this is disclosure rather than a breach; refusing
   * before parsing is still the right order, and it is one line.
   *
   * Safe at this phase because `req.params` is populated by the router before any hook runs, and no
   * `subject()` in this codebase reads `req.body` or `req.query` -- the shapes a subject is built
   * from are the actor and the path (grep-checked; `MODULE-GUIDE.md` states the contract).
   *
   * Fastify runs the global chain ahead of a 404 too (no matched route -> no `config`), so an
   * admin-scoped `setNotFoundHandler` can call `denyForSubject` itself (see `src/modules/admin.ts`)
   * instead of this hook ever seeing a permission for it.
   */
  app.addHook('preValidation', async (req, reply) => {
    const permission = req.routeOptions.config?.permission
    if (!permission) return
    if ('public' in permission && permission.public) return
    if ('action' in permission) {
      await denyForSubject(req, reply, permission.action, permission.subject(req))
    }
  })
})

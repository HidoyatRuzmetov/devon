// Global CSRF enforcement (HARDENING H1.4: "CSRF double-submit").
//
// `lib/csrf.ts` has always had the right check; what was missing was a guarantee that every
// state-changing route actually calls it. It did not: `modules/structure/index.ts` shipped seven
// mutating routes (`POST/PATCH/DELETE /departments/:id/units...`, `.../unit-roles...`) with no
// `checkCsrf` at all, and `POST /auth/logout` had none either -- a cross-site form post could
// create, rename, reorder or delete a department's whole org structure, or sign the victim out.
//
// The fix is structural, in the same spirit as `plugins/authorize.ts`'s `onRoute` boot guard: one
// `preHandler` on the root instance runs the double-submit check for every unsafe method, so a new
// route is protected by default and a route that must opt out has to say so in a diff (the
// `CSRF_EXEMPT_ROUTES` allow-list below, asserted by `test/unit/csrf-guard.test.ts`). The existing
// per-route `checkCsrf` calls are left exactly where they are -- they now run a second time on a
// request that already passed, which is free, and they keep working unchanged if this hook is ever
// scoped differently.
//
// Only a request that actually carries a session is checked. A request with no session cookie has
// no ambient authority to abuse, and `plugins/authorize.ts` already answers it 401 for every
// non-public route; checking CSRF first would turn those 401s into 403s and would make the
// pre-session routes (login, register, 2FA verify, first-boot setup) impossible to call at all.
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { checkCsrf } from '../lib/csrf.js'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Opt a route out of the global double-submit check. Only for a route whose caller cannot
     * carry the header and which proves its own authority another way -- see `CSRF_EXEMPT_ROUTES`. */
    csrfExempt?: true
  }
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

/**
 * Checked-in allow-list of routes that opt out with `config.csrfExempt`, in the same
 * "a diff, not a convention" style as `PUBLIC_ROUTES`. Every `{ public: true }` route is exempt
 * implicitly (a pre-session caller has no CSRF cookie to double-submit yet), so this list holds
 * only the *authenticated* exemptions.
 *
 * - `PUT /api/v1/storage/uploads`: the local storage driver's presigned-PUT endpoint. The browser
 *   sends the raw image bytes to a URL it was handed, with no JSON envelope and no application
 *   headers (`apiClient.uploadFile`, which must behave identically for a MinIO presigned URL on
 *   another origin). Its authority is the signed, expiring, single-object token in the query string
 *   *plus* a session whose user must match the token's (`plugins/storage.ts`) -- a cross-site
 *   attacker has neither, so there is nothing for CSRF to add.
 */
export const CSRF_EXEMPT_ROUTES: ReadonlyArray<{ method: string; url: string }> = Object.freeze([
  { method: 'PUT', url: '/api/v1/storage/uploads' },
])

declare module 'fastify' {
  interface FastifyInstance {
    /** Every state-changing route actually registered, with whether the guard exempts it. Populated
     * by this plugin's `onRoute` hook and walked by `test/unit/csrf-guard.test.ts`, exactly as
     * `authorize.ts`'s `publicRoutes` is walked by `public-routes.test.ts` -- so "is every mutating
     * route CSRF-protected?" is answered from the real route table, not from a constant. */
    csrfRoutes: { method: string; url: string; exempt: boolean }[]
  }
}

/** The guard's decision, extracted so it can be asserted per registered route without a request. */
export function isCsrfExemptRoute(config: {
  csrfExempt?: true
  permission?: { public?: true }
}): boolean {
  if (config.csrfExempt) return true
  return config.permission?.public === true
}

export default fp(async function csrfGuardPlugin(app: FastifyInstance) {
  app.decorate('csrfRoutes', [])

  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method]
    for (const method of methods) {
      if (SAFE_METHODS.has(method as string)) continue
      app.csrfRoutes.push({
        method: method as string,
        url: routeOptions.url,
        exempt: isCsrfExemptRoute(
          (routeOptions.config ?? {}) as { csrfExempt?: true; permission?: { public?: true } },
        ),
      })
    }
  })

  // `preValidation`, for the same reason `authorize.ts` is: a request this guard is going to refuse
  // should not have its body parsed and schema-checked first, because the validation error is itself
  // a description of the endpoint. Registered after `session` and `authorize` in `app.ts`, and
  // Fastify runs same-phase hooks in registration order, so the sequence is unchanged:
  // authenticate -> authorise -> prove intent -> validate -> handle.
  app.addHook('preValidation', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return
    // No session -> no ambient authority to forge with. (`authorize.ts` has already answered 401 for
    // every route that needed one; a public route is meant to be reachable without a cookie.)
    if (!req.sessionId) return

    const config = req.routeOptions.config
    if (
      isCsrfExemptRoute((config ?? {}) as { csrfExempt?: true; permission?: { public?: true } })
    ) {
      return
    }

    if (!checkCsrf(req, reply)) return reply
    return undefined
  })
})

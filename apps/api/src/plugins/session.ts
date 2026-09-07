// Resolves `request.actor` / `request.actorUser` / `request.sessionId` from the `devon_sid` cookie
// (design.md §2.2 `app.sessions`, ADR-003: Postgres row is the sole revocation record -- no Valkey
// mirror, so this lookup is the only place a session is ever considered valid). Runs as a global
// `preHandler`, ahead of `authorize.ts`'s permission check, so every route -- public or not -- sees a
// resolved (possibly `null`) actor.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Actor } from '@devon/contracts'
import { buildActor } from '../lib/actor.js'
import type { UserRecord } from '../types.js'
// EPIC-013 (admin module, I-8a "view-as"): the only line this module's `view-as.ts` needs from a
// shared file. `verifyViewAsCookie` is pure and self-contained (HMAC-verified, expiry-checked) --
// see that file's header for why this lives in `modules/admin/` rather than as a second edit here.
import { verifyViewAsCookie, VIEW_AS_COOKIE_NAME } from '../modules/admin/view-as.js'

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null
    actorUser: UserRecord | null
    sessionId: string | null
    csrfHash: string | null
  }
}

export function requestIp(req: FastifyRequest): string {
  return req.ip || ''
}

export function requestUserAgent(req: FastifyRequest): string {
  return (req.headers['user-agent'] as string | undefined) ?? ''
}

export default fp(async function sessionPlugin(app: FastifyInstance) {
  app.decorateRequest('actor', null)
  app.decorateRequest('actorUser', null)
  app.decorateRequest('sessionId', null)
  app.decorateRequest('csrfHash', null)

  app.addHook('preHandler', async (req) => {
    const cookieName = app.devonConfig.SESSION_COOKIE_NAME
    const raw = req.cookies[cookieName]
    if (!raw) return

    const loaded = await app.devon.findSessionByToken(raw)
    if (!loaded) return // expired/revoked/unknown token: request proceeds unauthenticated, never errors here.

    const memberships = await app.devon.listActiveMembershipsForUser(loaded.user.id)
    req.actor = buildActor(loaded.user, memberships)
    req.actorUser = loaded.user
    req.sessionId = loaded.session.id
    req.csrfHash = loaded.csrfHash

    // EPIC-013, I-8a: a super admin who started "view-as" carries a signed cookie naming the
    // department; every other module's routes already read `req.actor.viewAs` (see e.g.
    // `modules/work/context.ts`, `modules/events/index.ts`) and RLS's `... and not is_view_as()`
    // write policies already enforce the read-only half -- both have waited, unused, since EPIC-000
    // for exactly this one assignment. Never trusted for a non-super-admin session (a member/head
    // could never have set this cookie in the first place, but the check is explicit here too, fail-
    // closed, rather than relying on that alone).
    if (req.actor.role === 'super_admin') {
      const departmentId = verifyViewAsCookie(
        req.cookies[VIEW_AS_COOKIE_NAME],
        app.devonConfig.CSRF_SECRET,
      )
      if (departmentId) req.actor = { ...req.actor, viewAs: { departmentId } }
    }

    // Sliding idle window (TECH-SPEC §2.1: 12h idle / 30d absolute). Fire-and-forget: a slightly stale
    // `last_seen_at` under concurrent requests is cosmetic, never a security boundary (the absolute
    // `expires_at` and `revoked_at` columns are, and both are already checked inside
    // `findSessionByToken`).
    void app.devon.touchSession(loaded.session.id)
  })
})

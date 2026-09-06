// Builds a `@devon/db` `RequestContext` from an authenticated request -- the same shape
// `apps/api/src/db/repo.ts`'s `toDbContext` builds for the foundation module, duplicated here rather
// than imported because that file is the foundation's own, never a module's dependency
// (MODULE-GUIDE.md: a module's repo code goes through `@devon/db`'s `withContext()` directly, not
// through another module's `Deps`).
import type { RequestContext } from '@devon/db'
import type { FastifyRequest } from 'fastify'

export function contextFromRequest(req: FastifyRequest): RequestContext {
  const actor = req.actor
  return {
    requestId: req.id,
    userId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
    departmentId: actor?.departmentId ?? null,
    actingForUserId: null,
    viewAs: actor?.viewAs !== null && actor?.viewAs !== undefined,
    ip: req.ip || '',
    userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
  }
}

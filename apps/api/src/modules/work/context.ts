// Builds a `@devon/db` `RequestContext` from an authenticated request -- the same shape
// `apps/api/src/db/repo.ts`'s `toDbContext` builds for the foundation module, duplicated here rather
// than imported because that file is the foundation's own, never a module's dependency
// (MODULE-GUIDE.md: a module's repo code goes through `@devon/db`'s `withContext()` directly, not
// through another module's `Deps`).
import type { RequestContext } from '@devon/db'
import type { FastifyRequest } from 'fastify'
import { contextDepartmentRole } from '../../lib/actor.js'

export function contextFromRequest(req: FastifyRequest): RequestContext {
  const actor = req.actor
  return {
    requestId: req.id,
    userId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
    departmentId: actor?.departmentId ?? null,
    // v1.1: the per-department role RLS reads through `app.current_department_role()` (migration
    // 0904). Without it the GUC is NULL for every request this module makes, and any policy that
    // depends on it *alone* fails closed -- which is exactly what `app.goals` does, so creating a
    // goal 500'd for the one role allowed to create one (found live, `POST /goals` ->
    // "new row violates row-level security policy for table goals"). The tables whose policies read
    // `owner = current_user_id() OR role = 'head'` masked the bug, because the first half held.
    departmentRole: contextDepartmentRole(actor ?? null, actor?.departmentId ?? null),
    actingForUserId: null,
    viewAs: actor?.viewAs !== null && actor?.viewAs !== undefined,
    ip: req.ip || '',
    userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
  }
}

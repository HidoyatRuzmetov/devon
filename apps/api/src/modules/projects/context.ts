// Builds a `@devon/db` `RequestContext` from an authenticated request -- identical helper to
// `../work/context.ts`'s, duplicated rather than imported so the two modules stay independent
// (MODULE-GUIDE.md's additive-module philosophy: a module's own files, not a dependency on a sibling
// module's internals that could change out from under it).
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
    departmentRole: contextDepartmentRole(actor ?? null, actor?.departmentId ?? null),
    actingForUserId: null,
    viewAs: actor?.viewAs !== null && actor?.viewAs !== undefined,
    ip: req.ip || '',
    userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
  }
}

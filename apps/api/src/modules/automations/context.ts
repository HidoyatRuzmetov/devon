// `RequestContext` builders for the automations module (MODULE-GUIDE.md "API modules": a module's
// repo code goes through `@devon/db`'s `withContext()` directly, so it owns the context it passes).
//
// Two shapes, because this module writes from two places:
//  - `contextFromRequest` -- the head, on their own rule-builder screen.
//  - `systemContext` -- the engine, reacting to a domain event minutes after the request that
//    caused it has finished. It carries `departmentRole: 'head'` because the rules it reads are
//    head-only at the *database* boundary (`automation_rules_read` in migration 1100), and an
//    engine that could not read them would simply never fire. That is not a privilege escalation:
//    the engine has no HTTP surface, every action it takes is written to `app.automation_runs` where
//    the head can see it, and the rules themselves can only have been written by a head.
import { randomUUID } from 'node:crypto'
import type { RequestContext } from '@devon/db'
import type { FastifyRequest } from 'fastify'

export function contextFromRequest(req: FastifyRequest): RequestContext {
  const actor = req.actor
  return {
    requestId: req.id,
    userId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
    departmentId: actor?.departmentId ?? null,
    departmentRole:
      actor?.memberships.find((m) => m.departmentId === actor.departmentId)?.role ?? null,
    actingForUserId: null,
    viewAs: actor?.viewAs !== null && actor?.viewAs !== undefined,
    ip: req.ip || '',
    userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
  }
}

/** A fresh request id per call, so every audit and outbox row the engine writes stays individually
 * traceable -- the same convention `notifications/repo.ts`'s `systemAuditCtx` follows. */
export function scanContext(): RequestContext {
  return {
    requestId: randomUUID(),
    // Instance-level, department-less: the hourly tick's first question is "which departments have
    // a time-based rule at all", which no single department's lens can answer. Mirrors
    // `analytics/aggregate.ts`'s own `systemContext(null)` for the nightly recompute, and is used
    // for exactly that one read -- every write the engine makes runs under `systemContext` below,
    // scoped to one department.
    actorRole: 'super_admin',
    userId: null,
    departmentId: null,
    departmentRole: null,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-automations/scan',
  }
}

export function systemContext(departmentId: string, actingUserId: string | null): RequestContext {
  return {
    requestId: randomUUID(),
    userId: actingUserId,
    actorRole: null,
    departmentId,
    departmentRole: 'head',
    actingForUserId: null,
    viewAs: false,
    ip: '',
    userAgent: 'devon-automations/engine',
  }
}

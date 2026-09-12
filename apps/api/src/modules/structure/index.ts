// `/api/v1/departments/*` -- bo'limlar (units), unit roles and the People page's member list
// (EPIC-003, TECH-SPEC §2.3/§3.1). MODULE-GUIDE.md "API modules": every route declares
// `config.permission`; department-owned data uses `{kind:'department_child', departmentId}`, which
// `can()` (`@devon/contracts`) allows for any active member -- the head-vs-member distinction this
// item's settings gating needs (`allow_self_assign`/`allow_structure_edit`, both default-on) lives in
// `repo.ts`, one level below `can()`, exactly like design.md §2.3 describes it ("controlled by head
// settings", not a `can()`-level role check).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { StructureError } from './errors.js'
import * as repo from './repo.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { sendProblem } from '../../lib/problem-reply.js'
import {
  assignUnitRoleBodySchema,
  createUnitBodySchema,
  departmentParamsSchema,
  deletedUnitSchema,
  membersListSchema,
  reorderUnitsBodySchema,
  restoreUnitBodySchema,
  unitParamsSchema,
  unitRoleParamsSchema,
  unitRolesListSchema,
  unitRoleSchema,
  unitSchema,
  unitsOverviewSchema,
  updateUnitBodySchema,
} from './schemas.js'

function actorCtx(req: FastifyRequest): repo.ActorCtx {
  return {
    requestId: req.id,
    userId: req.actor!.userId,
    role: req.actor!.role,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

/** The caller's membership role *within this specific department* -- distinct from `req.actor.role`
 * (the instance-wide `super_admin|head|member`). `can()`'s `department_child` check has already
 * proven `req.actor.memberships` contains this department by the time a handler runs (or the request
 * never got here), so this is a lookup, never a second query. */
function roleInDepartment(req: FastifyRequest, departmentId: string): 'head' | 'member' {
  return req.actor!.memberships.find((m) => m.departmentId === departmentId)?.role ?? 'member'
}

const departmentChildSubject = (departmentId: string) => ({
  kind: 'department_child' as const,
  departmentId,
})

/** v1.1 SPEC §2.2 (D7): deleting or archiving a bo'lim rewrites everyone's home -- no department
 * switch opens it, so it is `{kind:'department_managed'}` at the `can()` layer rather than a setting
 * check inside the repo. */
const departmentManagedSubject = (departmentId: string) => ({
  kind: 'department_managed' as const,
  departmentId,
})

/** Turns this module's `StructureError` (settings gating, version conflicts, cross-department
 * references -- see `repo.ts`) into the same RFC 9457 `Problem` every other route sends, without a
 * plugin-scoped `setErrorHandler` that would shadow `src/app.ts`'s root one (and, with it, its
 * `err.validation` 422 formatting) for every route in this file. Anything else propagates to that
 * root handler unchanged, exactly as if this module had no error handling of its own. */
async function guarded<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof StructureError) {
      sendProblem(reply, err.code)
      return undefined
    }
    throw err
  }
}

const structurePlugin: FastifyPluginAsyncZod = async (app) => {
  // `GET /departments/mine` is the `accounts-departments` module's own route (full department detail,
  // registered under its `/departments` prefix) -- integrating this module alongside it surfaced a
  // route collision (Fastify: "Method 'GET' already declared for route '/departments/mine'") from this
  // module's own, lighter-weight duplicate of the same idea. `GET /api/v1/me` already returns real
  // memberships (EPIC-002's fix), so this feature's web side now reads them from there
  // (`use-my-departments.ts`, on top of `src/lib/session.ts`'s shared `useDepartment()`) instead of a
  // second endpoint; `repo.myDepartments`/`DepartmentsMine` stay in `repo.ts`/`schemas.ts`, unused by
  // any route, in case a later item wants the unit-count-free shape they compute.
  app.get(
    '/departments/:departmentId/units',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: { params: departmentParamsSchema, response: { 200: unitsOverviewSchema } },
    },
    async (req, reply) =>
      guarded(reply, async () => {
        const { departmentId } = req.params
        const overview = await repo.getUnitsOverview(actorCtx(req), departmentId)
        return { ...overview, myRole: roleInDepartment(req, departmentId) }
      }),
  )

  app.post(
    '/departments/:departmentId/units',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: {
        params: departmentParamsSchema,
        body: createUnitBodySchema,
        response: { 201: unitSchema },
      },
    },
    async (req, reply) => {
      const unit = await guarded(reply, () => {
        const { departmentId } = req.params
        return repo.createUnit(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          req.body,
        )
      })
      if (unit) reply.code(201).send(unit)
    },
  )

  app.patch(
    '/departments/:departmentId/units/:unitId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: {
        params: unitParamsSchema,
        body: updateUnitBodySchema,
        response: { 200: unitSchema },
      },
    },
    async (req, reply) =>
      guarded(reply, () => {
        const { departmentId, unitId } = req.params
        return repo.updateUnit(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          unitId,
          req.body,
        )
      }),
  )

  app.post(
    '/departments/:departmentId/units/reorder',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: { params: departmentParamsSchema, body: reorderUnitsBodySchema },
    },
    async (req, reply) => {
      const done = await guarded(reply, async () => {
        const { departmentId } = req.params
        await repo.reorderUnits(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          req.body,
        )
        return true
      })
      if (done) reply.code(204).send()
    },
  )

  app.delete(
    '/departments/:departmentId/units/:unitId',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) =>
            departmentManagedSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: { params: unitParamsSchema, response: { 200: deletedUnitSchema } },
    },
    async (req, reply) =>
      guarded(reply, () => {
        const { departmentId, unitId } = req.params
        return repo.deleteUnit(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          unitId,
        )
      }),
  )

  app.post(
    '/departments/:departmentId/units/:unitId/restore',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) =>
            departmentManagedSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: {
        params: unitParamsSchema,
        body: restoreUnitBodySchema,
        response: { 200: unitSchema },
      },
    },
    async (req, reply) =>
      guarded(reply, () => {
        const { departmentId, unitId } = req.params
        return repo.restoreUnit(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          unitId,
          req.body.deletedAt,
        )
      }),
  )

  app.get(
    '/departments/:departmentId/unit-roles',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: { params: departmentParamsSchema, response: { 200: unitRolesListSchema } },
    },
    async (req, reply) =>
      guarded(reply, () => repo.listUnitRoles(actorCtx(req), req.params.departmentId)),
  )

  app.post(
    '/departments/:departmentId/unit-roles',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: {
        params: departmentParamsSchema,
        body: assignUnitRoleBodySchema,
        response: { 201: unitRoleSchema },
      },
    },
    async (req, reply) => {
      const role = await guarded(reply, () => {
        const { departmentId } = req.params
        return repo.assignUnitRole(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          req.body,
        )
      })
      if (role) reply.code(201).send(role)
    },
  )

  app.delete(
    '/departments/:departmentId/unit-roles/:unitRoleId',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: { params: unitRoleParamsSchema },
    },
    async (req, reply) => {
      const done = await guarded(reply, async () => {
        const { departmentId, unitRoleId } = req.params
        await repo.unassignUnitRole(
          actorCtx(req),
          departmentId,
          roleInDepartment(req, departmentId),
          unitRoleId,
        )
        return true
      })
      if (done) reply.code(204).send()
    },
  )

  // `/departments/:departmentId/members` collides with the `accounts-departments` module's own route
  // of the same path (membership administration: status, joinedAt, remove/transfer-headship) --
  // integrating this module alongside it surfaced the same kind of duplicate this file's `mine` route
  // did (see the comment above). This module's shape is the org-chart roster (unit assignment, not
  // membership bookkeeping), so it gets its own path rather than losing either module's data.
  app.get(
    '/departments/:departmentId/roster',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) =>
            departmentChildSubject((r.params as { departmentId: string }).departmentId),
        },
      },
      schema: { params: departmentParamsSchema, response: { 200: membersListSchema } },
    },
    async (req, reply) =>
      guarded(reply, () => repo.listMembers(actorCtx(req), req.params.departmentId)),
  )
}

export default structurePlugin

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at bare `/api/v1` -- every route above
// starts with its own `/departments/...` segment.
export const prefix = ''

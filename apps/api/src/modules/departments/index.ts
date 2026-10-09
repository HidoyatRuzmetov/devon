// /api/v1/departments/* -- EPIC-002. `GET /join/:key` is the one public route this module adds
// (registered in `plugins/authorize.ts`'s `PUBLIC_ROUTES`); everything else requires a session, most
// of it scoped by `{kind:'department'|'department_child', departmentId}` (`packages/contracts/src/
// permissions.ts`) which already enforces "head only" for `update`/`delete` on `{kind:'department'}`.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sendProblem } from '../../lib/problem-reply.js'
import { checkCsrf } from '../../lib/csrf.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import * as repo from './repo.js'
import {
  createDepartmentRequestBodySchema,
  departmentDetailSchema,
  departmentIdParamsSchema,
  departmentListSchema,
  departmentRequestListSchema,
  featureFlagsSchema,
  inviteSecretSchema,
  inviteViewSchema,
  joinBodySchema,
  joinDecisionBodySchema,
  joinKeyParamsSchema,
  joinPreviewSchema,
  joinRequestListSchema,
  joinResultSchema,
  memberListSchema,
  memberParamsSchema,
  patchDepartmentSettingsBodySchema,
  putFeaturesBodySchema,
  rejectRequestBodySchema,
  resetMemberPasswordResultSchema,
  requestIdParamsSchema,
  setJoinApprovalBodySchema,
  setJoinPasswordBodySchema,
} from './schemas.js'

const departmentsRoutes: FastifyPluginAsyncZod = async (app) => {
  const ownAccount = (userId: string) => ({
    kind: 'own_account' as const,
    userId,
  })
  const department = (departmentId: string) => ({
    kind: 'department' as const,
    departmentId,
  })
  /** Head-only for reads and writes alike (SPEC §2.1) -- the join queue and a password reset are
   * management surfaces, not department-child ones. */
  const departmentManaged = (departmentId: string) => ({
    kind: 'department_managed' as const,
    departmentId,
  })
  const departmentChild = (departmentId: string) => ({
    kind: 'department_child' as const,
    departmentId,
  })
  const instance = () => ({ kind: 'instance' as const })

  function auditCtx(req: FastifyRequest) {
    return {
      requestId: req.id,
      userId: req.actor?.userId ?? null,
      actorRole: req.actor?.role ?? null,
      actingForUserId: null,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    }
  }

  function myRoleIn(req: FastifyRequest, departmentId: string): 'head' | 'member' | null {
    return req.actor?.memberships.find((m) => m.departmentId === departmentId)?.role ?? null
  }

  function requestToView(r: repo.DepartmentRequestRow) {
    return {
      id: r.id,
      requesterUserId: r.requesterUserId,
      requesterName: r.requesterName,
      name: r.name,
      description: r.description,
      units: r.units,
      locale: r.locale,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdDepartmentId: r.createdDepartmentId,
    }
  }

  function deptToView(d: repo.DepartmentDetail) {
    return {
      id: d.id,
      name: d.name,
      slug: d.slug,
      description: d.description,
      emoji: d.emoji,
      colour: d.colour,
      localeDefault: d.localeDefault,
      status: d.status,
      settings: {
        allowSelfAssign: d.settings.allowSelfAssign,
        allowStructureEdit: d.settings.allowStructureEdit,
        joinRequiresApproval: d.joinRequiresApproval,
        whoCanConnectTelegramGroup: d.settings.whoCanConnectTelegramGroup,
        quietHours: d.settings.quietHours,
        // SPEC §7: readable by every member (a member seeing "we do not use estimates here" is the
        // point); writable only through `PUT /:id/features`, which is head-only.
        features: d.features,
      },
      myRole: d.myRole,
      memberCount: d.memberCount,
    }
  }

  // -- Requests -----------------------------------------------------------------------------

  app.post(
    '/requests',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ownAccount(r.actor?.userId ?? ''),
        },
      },
      schema: { body: createDepartmentRequestBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const id = await repo.createDepartmentRequest(req.actor!.userId, req.body, auditCtx(req))
      return reply.code(201).send({ id })
    },
  )

  app.get(
    '/requests/mine',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ownAccount(r.actor?.userId ?? ''),
        },
      },
      schema: { response: { 200: departmentRequestListSchema } },
    },
    async (req, reply) => {
      const rows = await repo.listOwnDepartmentRequests(req.actor!.userId)
      return reply.send({ requests: rows.map(requestToView) })
    },
  )

  app.get(
    '/requests',
    {
      config: { permission: { action: 'administer', subject: instance } },
      schema: { response: { 200: departmentRequestListSchema } },
    },
    async (req, reply) => {
      const rawStatus = (req.query as { status?: string }).status
      const status =
        rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected'
          ? rawStatus
          : undefined
      const rows = await repo.listDepartmentRequests(status)
      return reply.send({ requests: rows.map(requestToView) })
    },
  )

  app.post(
    '/requests/:id/approve',
    {
      config: { permission: { action: 'administer', subject: instance } },
      schema: { params: requestIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.approveDepartmentRequest(req.params.id, auditCtx(req))
      if (!result) {
        sendProblem(reply, 'conflict')
        return
      }
      return reply.type('application/json').send(result)
    },
  )

  app.post(
    '/requests/:id/reject',
    {
      config: { permission: { action: 'administer', subject: instance } },
      schema: { params: requestIdParamsSchema, body: rejectRequestBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.rejectDepartmentRequest(req.params.id, req.body.reason, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'conflict')
        return
      }
      return reply.code(204).send()
    },
  )

  // -- My departments / detail / settings ----------------------------------------------------

  app.get(
    '/mine',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ownAccount(r.actor?.userId ?? ''),
        },
      },
      schema: { response: { 200: departmentListSchema } },
    },
    async (req, reply) => {
      const rows = await repo.listMyDepartments(req.actor!.userId)
      return reply.send({ departments: rows.map(deptToView) })
    },
  )

  app.get(
    '/:id',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChild((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        response: { 200: departmentDetailSchema },
      },
    },
    async (req, reply) => {
      const role = myRoleIn(req, req.params.id)
      const detail = await repo.getDepartmentDetail(
        req.params.id,
        req.actor!.userId,
        role ?? 'member',
      )
      if (!detail) {
        sendProblem(reply, 'not_found')
        return
      }
      return reply.type('application/json').send(deptToView(detail))
    },
  )

  app.patch(
    '/:id/settings',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        body: patchDepartmentSettingsBodySchema,
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.updateDepartmentSettings(req.params.id, req.actor!.userId, req.body, auditCtx(req))
      return reply.code(204).send()
    },
  )

  app.post(
    '/:id/deletion-request',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.requestDepartmentDeletion(req.params.id, auditCtx(req))
      return reply.code(204).send()
    },
  )

  // -- Invite ---------------------------------------------------------------------------------

  app.get(
    '/:id/invite',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        response: { 200: inviteViewSchema },
      },
    },
    async (req, reply) => {
      const invite = await repo.getInvite(req.params.id, req.actor!.userId)
      if (!invite) {
        sendProblem(reply, 'not_found')
        return
      }
      return reply.send({
        ...invite,
        // round2 critique #29: the configured public origin, not the client's own guess at it.
        joinUrl: invite.joinKey
          ? `${app.devonConfig.DEVON_PUBLIC_URL}/join?key=${invite.joinKey}`
          : null,
      })
    },
  )

  app.post(
    '/:id/invite/rotate-key',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        response: { 200: inviteSecretSchema.pick({ joinKey: true }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const joinKey = await repo.rotateJoinKey(req.params.id, auditCtx(req))
      return reply.send({ joinKey })
    },
  )

  app.post(
    '/:id/invite/rotate-password',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        response: { 200: inviteSecretSchema.pick({ password: true }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const password = await repo.rotateJoinPassword(req.params.id, auditCtx(req))
      return reply.send({ password })
    },
  )

  app.post(
    '/:id/invite/password',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        body: setJoinPasswordBodySchema,
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.setJoinPassword(req.params.id, req.body.password, auditCtx(req))
      return reply.code(204).send()
    },
  )

  app.patch(
    '/:id/invite/approval',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        body: setJoinApprovalBodySchema,
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.setJoinApproval(req.params.id, req.body.joinRequiresApproval, auditCtx(req))
      return reply.code(204).send()
    },
  )

  // -- Join -------------------------------------------------------------------------------------

  app.get(
    '/join/:key',
    {
      config: { permission: { public: true } },
      schema: {
        params: joinKeyParamsSchema,
        response: { 200: joinPreviewSchema },
      },
    },
    async (req, reply) => {
      const preview = await repo.getJoinPreview(req.params.key)
      if (!preview) {
        sendProblem(reply, 'not_found')
        return
      }
      return reply.type('application/json').send(preview)
    },
  )

  app.post(
    '/join',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ownAccount(r.actor?.userId ?? ''),
        },
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: { body: joinBodySchema, response: { 200: joinResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.joinByKeyAndPassword(
        req.actor!.userId,
        req.body.key,
        req.body.password,
        auditCtx(req),
      )
      if (!result.ok) {
        sendProblem(reply, result.reason === 'rate_limited' ? 'rate_limited' : 'not_found')
        return
      }
      return reply.send({
        departmentId: result.departmentId,
        status: result.status,
      })
    },
  )

  // -- Membership -------------------------------------------------------------------------------

  app.get(
    '/:id/members',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChild((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        response: { 200: memberListSchema },
      },
    },
    async (req, reply) => {
      const role = myRoleIn(req, req.params.id)
      const rows = await repo.listMembers(req.params.id, req.actor!.userId, role ?? 'member')
      return reply.send({
        members: rows.map((m) => ({
          userId: m.userId,
          givenName: m.givenName,
          familyName: m.familyName,
          patronymic: m.patronymic,
          title: m.title,
          avatarKey: m.avatarKey,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt.toISOString(),
        })),
      })
    },
  )

  app.post(
    '/:id/members/:userId/remove',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: { params: memberParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.removeMember(req.params.id, req.params.userId, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      return reply.code(204).send()
    },
  )

  app.post(
    '/:id/leave',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => departmentChild((r.params as { id: string }).id),
        },
      },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.leaveDepartment(req.params.id, req.actor!.userId, auditCtx(req))
      if (!result.ok) {
        sendProblem(reply, 'conflict')
        return
      }
      return reply.code(204).send()
    },
  )

  // -- Join-approval queue (v1.1 SPEC §2.2) ------------------------------------------------------
  //
  // `{kind:'department_managed'}`, not `{kind:'department'}`: a pending joiner's name is management
  // data (who tried to get in, and when), so the *read* is head-only too, not just the decision.
  // Both ids are in `apps/api/test/unit/head-only-routes.test.ts`.

  app.get(
    '/:id/join-requests',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentManaged((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        response: { 200: joinRequestListSchema },
      },
    },
    async (req, reply) => {
      const rows = await repo.listJoinRequests(req.params.id, auditCtx(req))
      return reply.send({
        requests: rows.map((r) => ({
          userId: r.userId,
          version: r.version,
          givenName: r.givenName,
          familyName: r.familyName,
          patronymic: r.patronymic,
          title: r.title,
          avatarKey: r.avatarKey,
          requestedAt: r.requestedAt.toISOString(),
        })),
      })
    },
  )

  for (const [segment, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
    // The undo behind the toast: puts an approved or rejected membership back in the queue, so a
    // mis-click is one click to reverse rather than a support request (DESIGN.md: undo over confirm).
    ['undo', 'pending'],
  ] as const) {
    app.post(
      `/:id/join-requests/:userId/${segment}`,
      {
        config: {
          permission: {
            action: 'update',
            subject: (r) => departmentManaged((r.params as { id: string }).id),
          },
        },
        schema: { params: memberParamsSchema, body: joinDecisionBodySchema },
      },
      async (req, reply) => {
        if (!checkCsrf(req, reply)) return
        // nosemgrep: query-in-loop -- registration loop creates callbacks; each HTTP request executes one decision.
        const ok = await repo.decideJoinRequest(
          req.params.id,
          req.params.userId,
          decision,
          auditCtx(req),
          req.body,
        )
        if (!ok) {
          // Another head already decided, or the membership moved on -- a conflict, not a 404: the
          // row exists, it just is not in the state this transition expects.
          sendProblem(reply, 'conflict')
          return
        }
        return reply.code(204).send()
      },
    )
  }

  // -- Imkoniyatlar switches (v1.1 SPEC §7) -------------------------------------------------------
  //
  // Read comes free with `GET /:id` (`settings.features`, visible to every member, read-only in the
  // UI). Only the write needs its own route, and it is `{kind:'department'} + update` = head-only.

  app.put(
    '/:id/features',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: {
        params: departmentIdParamsSchema,
        body: putFeaturesBodySchema,
        response: { 200: z.object({ features: featureFlagsSchema }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const features = await repo.updateFeatures(req.params.id, req.body.features, auditCtx(req))
      return reply.send({ features })
    },
  )

  // -- The head resets a member's password (v1.1 SPEC §2.2) ---------------------------------------

  app.post(
    '/:id/members/:userId/reset-password',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentManaged((r.params as { id: string }).id),
        },
        // Mints a credential; bounded the same way the super admin's own reset route is.
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        params: memberParamsSchema,
        response: { 200: resetMemberPasswordResultSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.resetMemberPassword(
        req.params.id,
        req.params.userId,
        req.actor!.userId,
        auditCtx(req),
      )
      if (!result.ok) {
        // `not_a_member` is a 404 (nothing here to reset); refusing to reset your own or another
        // head's password is a 409 -- the row is real, the transition is not allowed.
        sendProblem(reply, result.reason === 'not_a_member' ? 'not_found' : 'conflict')
        return
      }
      return reply.send({ temporaryPassword: result.temporaryPassword })
    },
  )

  app.post(
    '/:id/members/:userId/transfer-headship',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => department((r.params as { id: string }).id),
        },
      },
      schema: { params: memberParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.transferHeadship(
        req.params.id,
        req.actor!.userId,
        req.params.userId,
        auditCtx(req),
      )
      if (!ok) {
        sendProblem(reply, 'conflict')
        return
      }
      return reply.code(204).send()
    },
  )
}

export default departmentsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/departments`.
export const prefix = '/departments'

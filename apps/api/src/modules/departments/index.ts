// /api/v1/departments/* -- EPIC-002. `GET /join/:key` is the one public route this module adds
// (registered in `plugins/authorize.ts`'s `PUBLIC_ROUTES`); everything else requires a session, most
// of it scoped by `{kind:'department'|'department_child', departmentId}` (`packages/contracts/src/
// permissions.ts`) which already enforces "head only" for `update`/`delete` on `{kind:'department'}`.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
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
  inviteSecretSchema,
  inviteViewSchema,
  joinBodySchema,
  joinKeyParamsSchema,
  joinPreviewSchema,
  joinResultSchema,
  memberListSchema,
  memberParamsSchema,
  patchDepartmentSettingsBodySchema,
  rejectRequestBodySchema,
  requestIdParamsSchema,
  setJoinApprovalBodySchema,
  setJoinPasswordBodySchema,
} from './schemas.js'

const departmentsRoutes: FastifyPluginAsyncZod = async (app) => {
  const ownAccount = (userId: string) => ({ kind: 'own_account' as const, userId })
  const department = (departmentId: string) => ({ kind: 'department' as const, departmentId })
  const departmentChild = (departmentId: string) => ({ kind: 'department_child' as const, departmentId })
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
      },
      myRole: d.myRole,
      memberCount: d.memberCount,
    }
  }

  // -- Requests -----------------------------------------------------------------------------

  app.post(
    '/requests',
    {
      config: { permission: { action: 'create', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { body: createDepartmentRequestBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const id = await repo.createDepartmentRequest(req.actor!.userId, req.body, auditCtx(req))
      reply.code(201).send({ id })
    },
  )

  app.get(
    '/requests/mine',
    {
      config: { permission: { action: 'read', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: departmentRequestListSchema } },
    },
    async (req, reply) => {
      const rows = await repo.listOwnDepartmentRequests(req.actor!.userId)
      reply.send({ requests: rows.map(requestToView) })
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
      reply.send({ requests: rows.map(requestToView) })
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
      reply.send(result)
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
      reply.code(204).send()
    },
  )

  // -- My departments / detail / settings ----------------------------------------------------

  app.get(
    '/mine',
    {
      config: { permission: { action: 'read', subject: (r) => ownAccount(r.actor?.userId ?? '') } },
      schema: { response: { 200: departmentListSchema } },
    },
    async (req, reply) => {
      const rows = await repo.listMyDepartments(req.actor!.userId)
      reply.send({ departments: rows.map(deptToView) })
    },
  )

  app.get(
    '/:id',
    {
      config: { permission: { action: 'read', subject: (r) => departmentChild((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, response: { 200: departmentDetailSchema } },
    },
    async (req, reply) => {
      const role = myRoleIn(req, req.params.id)
      const detail = await repo.getDepartmentDetail(req.params.id, req.actor!.userId, role ?? 'member')
      if (!detail) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.send(deptToView(detail))
    },
  )

  app.patch(
    '/:id/settings',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, body: patchDepartmentSettingsBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.updateDepartmentSettings(req.params.id, req.actor!.userId, req.body, auditCtx(req))
      reply.code(204).send()
    },
  )

  app.post(
    '/:id/deletion-request',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.requestDepartmentDeletion(req.params.id, auditCtx(req))
      reply.code(204).send()
    },
  )

  // -- Invite ---------------------------------------------------------------------------------

  app.get(
    '/:id/invite',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, response: { 200: inviteViewSchema } },
    },
    async (req, reply) => {
      const invite = await repo.getInvite(req.params.id, req.actor!.userId)
      if (!invite) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.send(invite)
    },
  )

  app.post(
    '/:id/invite/rotate-key',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, response: { 200: inviteSecretSchema.pick({ joinKey: true }) } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const joinKey = await repo.rotateJoinKey(req.params.id, auditCtx(req))
      reply.send({ joinKey })
    },
  )

  app.post(
    '/:id/invite/rotate-password',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, response: { 200: inviteSecretSchema.pick({ password: true }) } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const password = await repo.rotateJoinPassword(req.params.id, auditCtx(req))
      reply.send({ password })
    },
  )

  app.post(
    '/:id/invite/password',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, body: setJoinPasswordBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.setJoinPassword(req.params.id, req.body.password, auditCtx(req))
      reply.code(204).send()
    },
  )

  app.patch(
    '/:id/invite/approval',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, body: setJoinApprovalBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.setJoinApproval(req.params.id, req.body.joinRequiresApproval, auditCtx(req))
      reply.code(204).send()
    },
  )

  // -- Join -------------------------------------------------------------------------------------

  app.get(
    '/join/:key',
    {
      config: { permission: { public: true } },
      schema: { params: joinKeyParamsSchema, response: { 200: joinPreviewSchema } },
    },
    async (req, reply) => {
      const preview = await repo.getJoinPreview(req.params.key)
      if (!preview) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.send(preview)
    },
  )

  app.post(
    '/join',
    {
      config: {
        permission: { action: 'create', subject: (r) => ownAccount(r.actor?.userId ?? '') },
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
      reply.send({ departmentId: result.departmentId, status: result.status })
    },
  )

  // -- Membership -------------------------------------------------------------------------------

  app.get(
    '/:id/members',
    {
      config: { permission: { action: 'read', subject: (r) => departmentChild((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema, response: { 200: memberListSchema } },
    },
    async (req, reply) => {
      const role = myRoleIn(req, req.params.id)
      const rows = await repo.listMembers(req.params.id, req.actor!.userId, role ?? 'member')
      reply.send({
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
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
      schema: { params: memberParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.removeMember(req.params.id, req.params.userId, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/:id/leave',
    {
      config: { permission: { action: 'delete', subject: (r) => departmentChild((r.params as { id: string }).id) } },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.leaveDepartment(req.params.id, req.actor!.userId, auditCtx(req))
      if (!result.ok) {
        sendProblem(reply, 'conflict')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/:id/members/:userId/transfer-headship',
    {
      config: { permission: { action: 'update', subject: (r) => department((r.params as { id: string }).id) } },
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
      reply.code(204).send()
    },
  )
}

export default departmentsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/departments`.
export const prefix = '/departments'

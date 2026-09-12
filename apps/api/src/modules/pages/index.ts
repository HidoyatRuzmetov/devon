// /api/v1/pages/* (TECH-SPEC §3.5; TASKS.md EPIC-011). Fastify plugin -- auto-discovered by
// `apps/api/src/module-loader.ts` (MODULE-GUIDE.md "API modules"). Every route declares
// `config.permission` with `{ kind: 'department_child' }` (any active member may read and write a
// department's pages/onboarding templates -- TECH-SPEC §2.3: "member ... create/edit/archive ...
// pages"); every mutation checks CSRF exactly like `PATCH /api/v1/me`.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { can } from '@devon/contracts'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import { registerOnboardingSubscription } from './onboarding.js'
import * as repo from './repo.js'
import {
  createOnboardingTemplateBodySchema,
  createPageBodySchema,
  onboardingTemplateListSchema,
  onboardingTemplateSchema,
  pageKindSchema,
  pageSchema,
  pageSummaryListSchema,
  pageVersionListSchema,
  pageVersionSchema,
  patchOnboardingTemplateBodySchema,
  patchPageBodySchema,
  restoreVersionBodySchema,
} from './schemas.js'
import type { OnboardingItem, OnboardingTemplateRow, PageRow, PageVersionRow } from './repo.js'

const idParamsSchema = z.object({ id: z.string().uuid() })
const pageVersionParamsSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
})
const listQuerySchema = z.object({ kind: pageKindSchema.optional() })

function activeDepartmentId(req: FastifyRequest): string {
  return req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? ''
}

function ctxFrom(req: FastifyRequest): AuditCtx {
  return {
    requestId: req.id,
    userId: req.actor!.userId,
    actorRole: req.actor!.role,
    actingForUserId: null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function pageToDto(row: PageRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    blocks: row.blocks,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

function versionToDto(row: PageVersionRow) {
  return {
    id: row.id,
    title: row.title,
    blocks: row.blocks,
    authorUserId: row.author_user_id,
    createdAt: row.created_at.toISOString(),
  }
}

function templateToDto(row: OnboardingTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    items: row.items as OnboardingItem[],
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

let onboardingSubscribed = false

const pagesRoutes: FastifyPluginAsyncZod = async (app) => {
  if (!onboardingSubscribed) {
    registerOnboardingSubscription(app.log)
    onboardingSubscribed = true
  }

  const departmentChildSubject = (r: FastifyRequest) => ({
    kind: 'department_child' as const,
    departmentId: activeDepartmentId(r),
  })

  /** v1.1 SPEC §2.2 (D4c): the onboarding checklist is how the head introduces a newcomer to the
   * department -- not a shared wiki page. Every member could create, edit and delete them, and the
   * client panel showed Add/Save/Trash to everyone. */
  const departmentManagedSubject = (r: FastifyRequest) => ({
    kind: 'department_managed' as const,
    departmentId: activeDepartmentId(r),
  })

  /**
   * v1.1 SPEC §2.2 (D4a/D4b). A wiki works because *editing* is open and version history is the
   * safety net -- deleting a page and rolling back somebody's work are not editing. Author or head.
   */
  const requirePageOwnership = async (
    req: FastifyRequest,
    reply: FastifyReply,
    pageId: string,
  ): Promise<boolean> => {
    const page = await repo.getPage(activeDepartmentId(req), pageId, ctxFrom(req))
    if (!page) {
      sendProblem(reply, 'not_found')
      return false
    }
    const decision = can(req.actor, 'delete', {
      kind: 'owned',
      departmentId: activeDepartmentId(req),
      ownerUserIds: [page.created_by_user_id],
    })
    if (!decision.allowed) {
      sendProblem(reply, 'forbidden')
      return false
    }
    return true
  }

  // -- Pages ------------------------------------------------------------------------------------------

  app.get(
    '/',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: {
        querystring: listQuerySchema,
        response: { 200: pageSummaryListSchema },
      },
    },
    async (req) => {
      const rows = await repo.listPages(activeDepartmentId(req), ctxFrom(req), req.query.kind)
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        createdByUserId: row.created_by_user_id,
        updatedByUserId: row.updated_by_user_id,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        version: row.version,
      }))
    },
  )

  app.get(
    '/:id',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: { params: idParamsSchema, response: { 200: pageSchema } },
    },
    async (req, reply) => {
      const row = await repo.getPage(activeDepartmentId(req), req.params.id, ctxFrom(req))
      if (!row) return sendProblem(reply, 'not_found')
      reply.send(pageToDto(row))
    },
  )

  app.post(
    '/',
    {
      config: {
        permission: { action: 'create', subject: departmentChildSubject },
      },
      schema: { body: createPageBodySchema, response: { 201: pageSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createPage(
        activeDepartmentId(req),
        req.actor!.userId,
        req.body,
        ctxFrom(req),
      )
      reply.code(201).send(pageToDto(row))
    },
  )

  app.patch(
    '/:id',
    {
      config: {
        permission: { action: 'update', subject: departmentChildSubject },
      },
      schema: {
        params: idParamsSchema,
        body: patchPageBodySchema,
        response: { 200: pageSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.patchPage(
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      reply.send(pageToDto(outcome.row))
    },
  )

  app.delete(
    '/:id',
    {
      config: {
        permission: { action: 'delete', subject: departmentChildSubject },
      },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (!(await requirePageOwnership(req, reply, req.params.id))) return
      const ok = await repo.deletePage(activeDepartmentId(req), req.params.id, ctxFrom(req))
      if (!ok) return sendProblem(reply, 'not_found')
      reply.code(204).send()
    },
  )

  // -- Versions (diff/restore) --------------------------------------------------------------------

  app.get(
    '/:id/versions',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: {
        params: idParamsSchema,
        response: { 200: pageVersionListSchema },
      },
    },
    async (req, reply) => {
      // H1.2: the version list is scoped by `department_id`, so another department's page id
      // produced 200 with an empty array rather than the 404 the page's own routes answer. Refuse on
      // the page itself, exactly like `GET /:id/versions/:versionId` one route below.
      if (!(await repo.getPage(activeDepartmentId(req), req.params.id, ctxFrom(req)))) {
        return sendProblem(reply, 'not_found')
      }
      const rows = await repo.listVersions(activeDepartmentId(req), req.params.id, ctxFrom(req))
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        authorUserId: row.author_user_id,
        createdAt: row.created_at.toISOString(),
      }))
    },
  )

  app.get(
    '/:id/versions/:versionId',
    {
      config: {
        permission: { action: 'read', subject: departmentChildSubject },
      },
      schema: {
        params: pageVersionParamsSchema,
        response: { 200: pageVersionSchema },
      },
    },
    async (req, reply) => {
      const row = await repo.getVersion(
        activeDepartmentId(req),
        req.params.id,
        req.params.versionId,
        ctxFrom(req),
      )
      if (!row) return sendProblem(reply, 'not_found')
      reply.send(versionToDto(row))
    },
  )

  app.post(
    '/:id/versions/restore',
    {
      config: {
        permission: { action: 'update', subject: departmentChildSubject },
      },
      schema: {
        params: idParamsSchema,
        body: restoreVersionBodySchema,
        response: { 200: pageSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (!(await requirePageOwnership(req, reply, req.params.id))) return
      const outcome = await repo.restoreVersion(
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
        req.body.versionId,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      reply.send(pageToDto(outcome.row))
    },
  )

  // -- Onboarding templates -------------------------------------------------------------------------

  app.get(
    '/onboarding/templates',
    {
      config: {
        permission: { action: 'read', subject: departmentManagedSubject },
      },
      schema: { response: { 200: onboardingTemplateListSchema } },
    },
    async (req) => {
      const rows = await repo.listOnboardingTemplates(activeDepartmentId(req), ctxFrom(req))
      return rows.map(templateToDto)
    },
  )

  app.post(
    '/onboarding/templates',
    {
      config: {
        permission: { action: 'create', subject: departmentManagedSubject },
      },
      schema: {
        body: createOnboardingTemplateBodySchema,
        response: { 201: onboardingTemplateSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createOnboardingTemplate(
        activeDepartmentId(req),
        req.actor!.userId,
        req.body,
        ctxFrom(req),
      )
      reply.code(201).send(templateToDto(row))
    },
  )

  app.patch(
    '/onboarding/templates/:id',
    {
      config: {
        permission: { action: 'update', subject: departmentManagedSubject },
      },
      schema: {
        params: idParamsSchema,
        body: patchOnboardingTemplateBodySchema,
        response: { 200: onboardingTemplateSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.patchOnboardingTemplate(
        activeDepartmentId(req),
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      reply.send(templateToDto(outcome.row))
    },
  )

  app.delete(
    '/onboarding/templates/:id',
    {
      config: {
        permission: { action: 'delete', subject: departmentManagedSubject },
      },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.deleteOnboardingTemplate(
        activeDepartmentId(req),
        req.params.id,
        ctxFrom(req),
      )
      if (!ok) return sendProblem(reply, 'not_found')
      reply.code(204).send()
    },
  )
}

export default pagesRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/pages`.
export const prefix = '/pages'

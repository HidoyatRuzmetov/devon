// Group projects (TECH-SPEC §3.2, EPIC-005): members, objective/subjective progress, milestones,
// templates. `{kind:'department_child'}`, scoped to `req.actor.departmentId` -- same reasoning as
// `../work/index.ts`.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { can } from '@devon/contracts'
import { isHeadOf } from '../../lib/actor.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'
import * as repo from './repo.js'
import {
  addMilestoneBodySchema,
  createFromTemplateBodySchema,
  createProjectBodySchema,
  idParamsSchema,
  milestoneParamsSchema,
  patchMilestoneBodySchema,
  patchProjectBodySchema,
  projectListSchema,
  projectSchema,
  templateListSchema,
  type ProjectDTO,
} from './schemas.js'

function departmentChildSubject(departmentId: string | null) {
  return {
    kind: 'department_child' as const,
    departmentId: departmentId ?? '',
  }
}

/**
 * v1.1 SPEC §2.1 (D5a/D5c). A project's owner -- and the head -- decide what the project says; a
 * colleague who happens to be in the same department does not. The owner set is the project's
 * `ownerUserId` plus its `members`, because someone working inside a project may legitimately move
 * its milestones.
 *
 * 404 for a project that is not this department's (identical to every read route's answer for a
 * foreign id), 403 for a real project the caller does not own.
 */
async function requireProjectOwnership(
  req: FastifyRequest,
  reply: FastifyReply,
  departmentId: string,
  projectId: string,
): Promise<{ ok: true; project: ProjectDTO } | { ok: false }> {
  const project = await repo.getProject(contextFromRequest(req), departmentId, projectId)
  if (!project) {
    sendProblem(reply, 'not_found')
    return { ok: false }
  }
  const decision = can(req.actor, 'update', {
    kind: 'owned',
    departmentId,
    ownerUserIds: [project.ownerUserId, ...project.members].filter(Boolean),
  })
  if (!decision.allowed) {
    sendProblem(reply, 'forbidden')
    return { ok: false }
  }
  return { ok: true, project }
}

/** D5b: `ownerUserId` came straight from the request body, so any member could appoint anyone --
 * including themselves -- to lead a piece of work. Creating is open to everyone (a xodim may start a
 * piece of work); *naming someone else the owner* is a management act, so a member's new project is
 * owned by the member who created it and only a head may point it elsewhere. */
function resolveOwnerOnCreate(req: FastifyRequest, requested: string | undefined): string {
  const me = req.actor!.userId
  if (!requested || requested === me) return me
  return isHeadOf(req.actor, requireDepartmentId(req)) ? requested : me
}

function requireDepartmentId(req: {
  actor: { departmentId: string | null } | null
}): string | null {
  return req.actor?.departmentId ?? null
}

/** The one built-in template (TECH-SPEC §5's group-projects deliverable list: "templates" plural in
 * the epic list, "one template" in this build's own scope note) -- a generic project shape (kickoff,
 * mid checkpoint, wrap-up) any department can start from, offsets in days from the project's
 * `startOn`. */
const PROJECT_TEMPLATES = [
  {
    key: 'standard-project',
    title: 'Standart loyiha',
    description:
      'Boshlanishi, oraliq nazorat va yakunlash bosqichlariga ega umumiy loyiha shabloni.',
    milestones: [
      { title: 'Boshlash', offsetDays: 0 },
      { title: 'Oraliq nazorat', offsetDays: 30 },
      { title: 'Yakunlash', offsetDays: 60 },
    ],
  },
] as const

const projectsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: projectListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      reply.send(departmentId ? await repo.listProjects(contextFromRequest(req), departmentId) : [])
    },
  )

  app.get(
    '/projects/templates',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: templateListSchema } },
    },
    async (_req, reply) => {
      reply.send(PROJECT_TEMPLATES.map((t) => ({ ...t, milestones: [...t.milestones] })))
    },
  )

  app.post(
    '/projects/from-template',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createFromTemplateBodySchema,
        response: { 201: projectSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const template = PROJECT_TEMPLATES.find((t) => t.key === req.body.templateKey)
      if (!template) return sendProblem(reply, 'not_found')
      const departmentId = requireDepartmentId(req)!
      const startOn = req.body.startOn ?? new Date().toISOString().slice(0, 10)
      const startDate = new Date(`${startOn}T00:00:00.000Z`)
      const milestones = template.milestones.map((m) => ({
        title: m.title,
        dueOn: new Date(startDate.getTime() + m.offsetDays * 86_400_000).toISOString().slice(0, 10),
      }))
      const project = await repo.createProject(contextFromRequest(req), {
        departmentId,
        title: req.body.title ?? template.title,
        description: template.description,
        colour: undefined,
        ownerUserId: resolveOwnerOnCreate(req, req.body.ownerUserId),
        members: req.body.members,
        status: 'planning',
        startOn,
        targetOn: milestones.at(-1)?.dueOn,
        milestones,
      })
      reply.code(201).send(project)
    },
  )

  app.post(
    '/projects',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createProjectBodySchema,
        response: { 201: projectSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const project = await repo.createProject(contextFromRequest(req), {
        departmentId,
        title: req.body.title,
        description: req.body.description,
        colour: req.body.colour,
        ownerUserId: resolveOwnerOnCreate(req, req.body.ownerUserId),
        members: req.body.members,
        status: req.body.status,
        startOn: req.body.startOn,
        targetOn: req.body.targetOn,
        milestones: req.body.milestones?.map((m) => ({
          title: m.title,
          dueOn: m.dueOn,
        })),
      })
      reply.code(201).send(project)
    },
  )

  app.get(
    '/projects/:id',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 200: projectSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      const project = await repo.getProject(contextFromRequest(req), departmentId, req.params.id)
      if (!project) return sendProblem(reply, 'not_found')
      reply.send(project)
    },
  )

  app.patch(
    '/projects/:id',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: patchProjectBodySchema,
        response: { 200: projectSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const { version, ...patch } = req.body
      const ownership = await requireProjectOwnership(req, reply, departmentId, req.params.id)
      if (!ownership.ok) return
      // D5b again, on the way in: re-pointing an existing project at a different owner is head-only.
      if (
        patch.ownerUserId !== undefined &&
        patch.ownerUserId !== ownership.project.ownerUserId &&
        !isHeadOf(req.actor, departmentId)
      ) {
        return sendProblem(reply, 'forbidden')
      }
      const result = await repo.patchProject(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        patch,
        version,
      )
      if (!result.ok)
        return sendProblem(reply, result.reason === 'conflict' ? 'conflict' : 'not_found')
      reply.send(result.project)
    },
  )

  app.post(
    '/projects/:id/milestones',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: addMilestoneBodySchema,
        response: { 200: projectSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const addOwnership = await requireProjectOwnership(req, reply, departmentId, req.params.id)
      if (!addOwnership.ok) return
      const project = await repo.addMilestone(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.body,
      )
      if (!project) return sendProblem(reply, 'not_found')
      reply.send(project)
    },
  )

  app.patch(
    '/projects/:id/milestones/:milestoneId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: milestoneParamsSchema,
        body: patchMilestoneBodySchema,
        response: { 200: projectSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const patchOwnership = await requireProjectOwnership(req, reply, departmentId, req.params.id)
      if (!patchOwnership.ok) return
      const project = await repo.patchMilestone(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.params.milestoneId,
        req.body,
      )
      if (!project) return sendProblem(reply, 'not_found')
      reply.send(project)
    },
  )
}

export default projectsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1`.
export const prefix = ''

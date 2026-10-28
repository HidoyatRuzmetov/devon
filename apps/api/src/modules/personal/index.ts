// The personal workspace (TECH-SPEC §3.3, TASKS.md EPIC-009): sprints, nested tasks, notes, canvases,
// Pomodoro settings/sessions -- every route here is `{ kind: 'personal', ownerUserId }` (I-1: owner
// only, never a head, never the super admin's view-as, no exception, ever).
//
// Mounted at `/api/v1/personal/*`. Every mutating route runs `checkCsrf` first (the same double-submit
// check `PATCH /api/v1/me` uses -- `apps/api/src/lib/csrf.ts`'s header names ADR-003 as "the whole
// product"'s compensating control for `SameSite=Lax`, not a `/me`-only rule).
import {
  personalDeleteReceiptSchema,
  personalRestoreBodySchema,
  personalTaskVersionChangeSchema,
  personalTaskVersionsQuerySchema,
} from '@devon/contracts'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import { calendarRoutes } from './calendar-routes.js'
import { pomodoroSessionToDto, pomodoroSettingsToDto, taskToDto } from './dto.js'
import * as repo from './repo.js'
import {
  createPomodoroSessionBodySchema,
  createTaskBodySchema,
  patchPomodoroSessionBodySchema,
  patchPomodoroSettingsBodySchema,
  patchTaskBodySchema,
  pomodoroSessionListSchema,
  pomodoroSessionSchema,
  pomodoroSettingsSchema,
  reorderTasksBodySchema,
  taskListSchema,
  taskSchema,
} from './schemas.js'

const idParamsSchema = z.object({ id: z.string().uuid() })
const deleteQuerySchema = z.object({ receipt: z.enum(['true', 'false']).optional() })

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

const personalRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(calendarRoutes)
  const ownerSubject = (r: { actor: { userId: string } | null }) => ({
    kind: 'personal' as const,
    ownerUserId: r.actor?.userId ?? '',
  })

  // -- Tasks ------------------------------------------------------------------------------------------

  app.get(
    '/tasks',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { response: { 200: taskListSchema } },
    },
    async (req) => {
      const rows = await repo.listTasks(req.actor!.userId, ctxFrom(req))
      return rows.map(taskToDto)
    },
  )

  app.post(
    '/tasks',
    {
      config: { permission: { action: 'create', subject: ownerSubject } },
      schema: { body: createTaskBodySchema, response: { 201: taskSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createTask(req.actor!.userId, req.body, ctxFrom(req))
      return reply.code(201).send(taskToDto(row))
    },
  )

  app.patch(
    '/tasks/:id',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        body: patchTaskBodySchema,
        querystring: personalTaskVersionsQuerySchema,
        response: {
          200: z.union([
            taskSchema,
            z.object({
              task: taskSchema,
              affectedVersions: z.array(personalTaskVersionChangeSchema),
            }),
          ]),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (req.body.parentId === req.params.id) {
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'parentId', code: 'self_reference' }],
        })
      }
      const outcome = await repo.patchTask(req.actor!.userId, req.params.id, req.body, ctxFrom(req))
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      if (req.query.versions === 'true')
        return reply.send({
          task: taskToDto(outcome.row),
          affectedVersions: outcome.affectedVersions,
        })
      return reply.type('application/json').send(taskToDto(outcome.row))
    },
  )

  app.delete(
    '/tasks/:id',
    {
      config: { permission: { action: 'delete', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        querystring: deleteQuerySchema,
        response: { 200: personalDeleteReceiptSchema, 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const receipt = await repo.deleteTask(req.actor!.userId, req.params.id, ctxFrom(req))
      if (!receipt) return sendProblem(reply, 'not_found')
      if (req.query.receipt === 'true') return reply.type('application/json').send(receipt)
      return reply.code(204).send()
    },
  )

  app.post(
    '/tasks/:id/restore',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        body: personalRestoreBodySchema,
        response: { 200: taskSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.restoreTask(
        req.actor!.userId,
        req.params.id,
        req.body.restoreToken,
        ctxFrom(req),
      )
      if (result.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (result.ok === 'conflict') return sendProblem(reply, 'conflict')
      return reply.type('application/json').send(taskToDto(result.row))
    },
  )

  app.post(
    '/tasks/reorder',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        body: reorderTasksBodySchema,
        querystring: personalTaskVersionsQuerySchema,
        response: {
          200: z.object({
            updated: z.number().int(),
            affectedVersions: z.array(personalTaskVersionChangeSchema).optional(),
          }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.reorderTasks(req.actor!.userId, req.body.items, ctxFrom(req))
      return reply
        .type('application/json')
        .send(req.query.versions === 'true' ? result : { updated: result.updated })
    },
  )

  // -- Pomodoro ---------------------------------------------------------------------------------------

  app.get(
    '/pomodoro/settings',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { response: { 200: pomodoroSettingsSchema } },
    },
    async (req) => {
      const row = await repo.getPomodoroSettings(req.actor!.userId, ctxFrom(req))
      return pomodoroSettingsToDto(row)
    },
  )

  app.patch(
    '/pomodoro/settings',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: { body: patchPomodoroSettingsBodySchema, response: { 200: pomodoroSettingsSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.patchPomodoroSettings(req.actor!.userId, req.body, ctxFrom(req))
      return reply.type('application/json').send(pomodoroSettingsToDto(row))
    },
  )

  app.get(
    '/pomodoro/sessions',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
        response: { 200: pomodoroSessionListSchema },
      },
    },
    async (req) => {
      const rows = await repo.listPomodoroSessions(req.actor!.userId, ctxFrom(req), {
        limit: req.query.limit,
      })
      return rows.map(pomodoroSessionToDto)
    },
  )

  app.post(
    '/pomodoro/sessions',
    {
      config: { permission: { action: 'create', subject: ownerSubject } },
      schema: { body: createPomodoroSessionBodySchema, response: { 201: pomodoroSessionSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createPomodoroSession(req.actor!.userId, req.body, ctxFrom(req))
      return reply.code(201).send(pomodoroSessionToDto(row))
    },
  )

  app.patch(
    '/pomodoro/sessions/:id',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        body: patchPomodoroSessionBodySchema,
        response: { 200: pomodoroSessionSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.patchPomodoroSession(
        req.actor!.userId,
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (!row) return sendProblem(reply, 'not_found')
      return reply.type('application/json').send(pomodoroSessionToDto(row))
    },
  )
}

export default personalRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/personal`.
export const prefix = '/personal'

// The personal workspace (TECH-SPEC §3.3, TASKS.md EPIC-009): sprints, nested tasks, notes, canvases,
// Pomodoro settings/sessions -- every route here is `{ kind: 'personal', ownerUserId }` (I-1: owner
// only, never a head, never the super admin's view-as, no exception, ever).
//
// Mounted at `/api/v1/personal/*`. Every mutating route runs `checkCsrf` first (the same double-submit
// check `PATCH /api/v1/me` uses -- `apps/api/src/lib/csrf.ts`'s header names ADR-003 as "the whole
// product"'s compensating control for `SameSite=Lax`, not a `/me`-only rule).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  canvasSummaryToDto,
  canvasToDto,
  noteToDto,
  pomodoroSessionToDto,
  pomodoroSettingsToDto,
  pomodoroStatsToDto,
  sprintToDto,
  taskToDto,
} from './dto.js'
import * as repo from './repo.js'
import {
  canvasSchema,
  canvasSummaryListSchema,
  createCanvasBodySchema,
  createNoteBodySchema,
  createPomodoroSessionBodySchema,
  createSprintBodySchema,
  createTaskBodySchema,
  noteListSchema,
  noteSchema,
  patchCanvasBodySchema,
  patchNoteBodySchema,
  patchPomodoroSessionBodySchema,
  patchPomodoroSettingsBodySchema,
  patchSprintBodySchema,
  patchTaskBodySchema,
  pomodoroSessionListSchema,
  pomodoroSessionSchema,
  pomodoroSettingsSchema,
  pomodoroStatsSchema,
  reorderTasksBodySchema,
  rolloverSprintBodySchema,
  sprintListSchema,
  sprintSchema,
  taskListSchema,
  taskSchema,
} from './schemas.js'

const idParamsSchema = z.object({ id: z.string().uuid() })

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
  const ownerSubject = (r: { actor: { userId: string } | null }) => ({
    kind: 'personal' as const,
    ownerUserId: r.actor?.userId ?? '',
  })

  // -- Sprints --------------------------------------------------------------------------------------

  app.get(
    '/sprints',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { response: { 200: sprintListSchema } },
    },
    async (req) => {
      const rows = await repo.listSprints(req.actor!.userId, ctxFrom(req))
      return rows.map(sprintToDto)
    },
  )

  app.post(
    '/sprints',
    {
      config: { permission: { action: 'create', subject: ownerSubject } },
      schema: { body: createSprintBodySchema, response: { 201: sprintSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createSprint(req.actor!.userId, req.body, ctxFrom(req))
      return reply.code(201).send(sprintToDto(row))
    },
  )

  app.patch(
    '/sprints/:id',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        body: patchSprintBodySchema,
        response: { 200: sprintSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.patchSprint(
        req.actor!.userId,
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      return reply.send(sprintToDto(outcome.row))
    },
  )

  app.post(
    '/sprints/:id/rollover',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        body: rolloverSprintBodySchema,
        response: { 200: z.object({ sprint: sprintSchema, movedTaskCount: z.number().int() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.rolloverSprint(
        req.actor!.userId,
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      return reply.send({
        sprint: sprintToDto(outcome.sprint),
        movedTaskCount: outcome.movedTaskCount,
      })
    },
  )

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
      schema: { params: idParamsSchema, body: patchTaskBodySchema, response: { 200: taskSchema } },
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
      return reply.send(taskToDto(outcome.row))
    },
  )

  app.delete(
    '/tasks/:id',
    {
      config: { permission: { action: 'delete', subject: ownerSubject } },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.deleteTask(req.actor!.userId, req.params.id, ctxFrom(req))
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.post(
    '/tasks/reorder',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        body: reorderTasksBodySchema,
        response: { 200: z.object({ updated: z.number().int() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const updated = await repo.reorderTasks(req.actor!.userId, req.body.items, ctxFrom(req))
      return reply.send({ updated })
    },
  )

  // -- Notes ------------------------------------------------------------------------------------------

  app.get(
    '/notes',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { response: { 200: noteListSchema } },
    },
    async (req) => {
      const rows = await repo.listNotes(req.actor!.userId, ctxFrom(req))
      return rows.map(noteToDto)
    },
  )

  app.post(
    '/notes',
    {
      config: { permission: { action: 'create', subject: ownerSubject } },
      schema: { body: createNoteBodySchema, response: { 201: noteSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createNote(req.actor!.userId, req.body, ctxFrom(req))
      return reply.code(201).send(noteToDto(row))
    },
  )

  app.patch(
    '/notes/:id',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: { params: idParamsSchema, body: patchNoteBodySchema, response: { 200: noteSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.patchNote(req.actor!.userId, req.params.id, req.body, ctxFrom(req))
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      return reply.send(noteToDto(outcome.row))
    },
  )

  app.delete(
    '/notes/:id',
    {
      config: { permission: { action: 'delete', subject: ownerSubject } },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.deleteNote(req.actor!.userId, req.params.id, ctxFrom(req))
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  // -- Canvases ---------------------------------------------------------------------------------------

  app.get(
    '/canvases',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { response: { 200: canvasSummaryListSchema } },
    },
    async (req) => {
      const rows = await repo.listCanvases(req.actor!.userId, ctxFrom(req))
      return rows.map(canvasSummaryToDto)
    },
  )

  app.get(
    '/canvases/:id',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { params: idParamsSchema, response: { 200: canvasSchema } },
    },
    async (req, reply) => {
      const row = await repo.getCanvas(req.actor!.userId, req.params.id, ctxFrom(req))
      if (!row) return sendProblem(reply, 'not_found')
      return reply.send(canvasToDto(row))
    },
  )

  app.post(
    '/canvases',
    {
      config: { permission: { action: 'create', subject: ownerSubject } },
      schema: { body: createCanvasBodySchema, response: { 201: canvasSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createCanvas(req.actor!.userId, req.body, ctxFrom(req))
      return reply.code(201).send(canvasToDto(row))
    },
  )

  app.patch(
    '/canvases/:id',
    {
      config: { permission: { action: 'update', subject: ownerSubject } },
      schema: {
        params: idParamsSchema,
        body: patchCanvasBodySchema,
        response: { 200: canvasSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.patchCanvas(
        req.actor!.userId,
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      return reply.send(canvasToDto(outcome.row))
    },
  )

  app.delete(
    '/canvases/:id',
    {
      config: { permission: { action: 'delete', subject: ownerSubject } },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.deleteCanvas(req.actor!.userId, req.params.id, ctxFrom(req))
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
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
      return reply.send(pomodoroSettingsToDto(row))
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
      return reply.send(pomodoroSessionToDto(row))
    },
  )

  app.get(
    '/pomodoro/stats',
    {
      config: { permission: { action: 'read', subject: ownerSubject } },
      schema: { response: { 200: pomodoroStatsSchema } },
    },
    async (req) => {
      const row = await repo.getPomodoroStats(req.actor!.userId, ctxFrom(req))
      return pomodoroStatsToDto(row)
    },
  )
}

export default personalRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/personal`.
export const prefix = '/personal'

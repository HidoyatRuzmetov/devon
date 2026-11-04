import {
  checkinAddSchema,
  checkinBoardSchema,
  checkinLockSchema,
  checkinUpdateSchema,
  checkinSourceCardSchema,
  checkinSelectionSchema,
  checkinLayoutWriteSchema,
  checkinCreateTaskSchema,
} from '@devon/contracts'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import * as repo from './repo.js'
import { WorkPlanError } from '../work/workflow-repo.js'
import { workflowResultSchema } from '../work/workflow-schemas.js'

const subject = (req: FastifyRequest) => ({
  kind: 'department_child' as const,
  departmentId: req.actor?.departmentId ?? '',
})
const params = z.object({ id: z.string().uuid() })
const routes: FastifyPluginAsyncZod = async (app) => {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof repo.CheckinError || error instanceof WorkPlanError)
      return sendProblem(reply, error.code, { errors: [{ path: 'checkin', code: error.reason }] })
    // Drizzle wraps PostgreSQL trigger failures in a query error; keep lock conflicts as 409s.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    if (cause instanceof Error && ['checkout_locked', 'checkin_locked'].includes(cause.message))
      return sendProblem(reply, 'conflict', { errors: [{ path: 'checkin', code: cause.message }] })
    throw error
  })
  const memberParams = params.extend({ memberUserId: z.string().uuid() })
  app.post(
    '/cycles/:id/members/:memberUserId/tasks',
    {
      config: {
        permission: {
          action: 'create',
          subject: (req) => ({
            kind: 'department_managed',
            departmentId: req.actor?.departmentId ?? '',
          }),
        },
      },
      schema: {
        params: memberParams,
        body: checkinCreateTaskSchema,
        response: { 201: workflowResultSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return reply
        .code(201)
        .send(
          await repo.createIndividualTask(
            contextFromRequest(req),
            req.params.id,
            req.params.memberUserId,
            req.body,
          ),
        )
    },
  )
  app.get(
    '/cycles/:id/members/:memberUserId/candidates',
    {
      config: { permission: { action: 'read', subject } },
      schema: { params: memberParams, response: { 200: z.array(checkinSourceCardSchema) } },
    },
    async (req) => repo.candidates(contextFromRequest(req), req.params.id, req.params.memberUserId),
  )
  app.put(
    '/cycles/:id/members/:memberUserId/selection',
    {
      config: { permission: { action: 'update', subject } },
      schema: {
        params: memberParams,
        body: checkinSelectionSchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.saveSelection(
        contextFromRequest(req),
        req.params.id,
        req.params.memberUserId,
        req.body,
      )
      return reply.code(204).send()
    },
  )
  app.put(
    '/cycles/:id/members/:memberUserId/layout',
    {
      config: { permission: { action: 'update', subject } },
      schema: {
        params: memberParams,
        body: checkinLayoutWriteSchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.saveLayout(
        contextFromRequest(req),
        req.params.id,
        req.params.memberUserId,
        req.body,
      )
      return reply.code(204).send()
    },
  )

  app.get(
    '/',
    {
      config: { permission: { action: 'read', subject } },
      schema: {
        querystring: z.object({ cycleId: z.string().uuid().optional() }),
        response: { 200: checkinBoardSchema },
      },
    },
    async (req) => repo.board(contextFromRequest(req), req.query.cycleId),
  )
  app.post(
    '/cycles/:id/entries',
    {
      config: { permission: { action: 'update', subject } },
      schema: {
        params,
        body: checkinAddSchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return reply
        .code(201)
        .send(await repo.addEntry(contextFromRequest(req), req.params.id, req.body.checklistItemId))
    },
  )
  app.patch(
    '/entries/:id',
    {
      config: { permission: { action: 'update', subject } },
      schema: { params, body: checkinUpdateSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.updateEntry(contextFromRequest(req), req.params.id, req.body)
      return reply.code(204).send()
    },
  )
  app.delete(
    '/entries/:id',
    {
      config: { permission: { action: 'update', subject } },
      schema: { params, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.removeEntry(contextFromRequest(req), req.params.id)
      return reply.code(204).send()
    },
  )
  app.post(
    '/cycles/:id/lock',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'department_managed',
            departmentId: r.actor?.departmentId ?? '',
          }),
        },
      },
      schema: { params, body: checkinLockSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.lockCycle(
        contextFromRequest(req),
        req.params.id,
        req.body.phase,
        req.body.memberUserId,
      )
      return reply.code(204).send()
    },
  )
}
export default routes
export const prefix = '/checkins'

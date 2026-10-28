import {
  checkinAddSchema,
  checkinBoardSchema,
  checkinLockSchema,
  checkinUpdateSchema,
} from '@devon/contracts'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import * as repo from './repo.js'

const subject = (req: FastifyRequest) => ({
  kind: 'department_child' as const,
  departmentId: req.actor?.departmentId ?? '',
})
const params = z.object({ id: z.string().uuid() })
const routes: FastifyPluginAsyncZod = async (app) => {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof repo.CheckinError)
      return sendProblem(reply, error.code, { errors: [{ path: 'checkin', code: error.reason }] })
    if (error instanceof Error && ['checkout_locked', 'checkin_locked'].includes(error.message))
      return sendProblem(reply, 'conflict', { errors: [{ path: 'checkin', code: error.message }] })
    throw error
  })
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
      await repo.lockCycle(contextFromRequest(req), req.params.id, req.body.phase)
      return reply.code(204).send()
    },
  )
}
export default routes
export const prefix = '/checkins'

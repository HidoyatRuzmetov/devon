import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'
import { applyCardChecklistPlan, assignMany, WorkPlanError } from './workflow-repo.js'
import {
  assignManySchema,
  cardChecklistPlanSchema,
  workflowResultSchema,
} from './workflow-schemas.js'

export const workflowRoutes: FastifyPluginAsyncZod = async (app) => {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof WorkPlanError)
      return sendProblem(reply, error.code, { errors: [{ path: 'plan', code: error.reason }] })
    throw error
  })
  app.post(
    '/cards/with-checklist',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({ kind: 'department_child', departmentId: r.actor?.departmentId ?? '' }),
        },
      },
      schema: { body: cardChecklistPlanSchema, response: { 200: workflowResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const operation = z.string().uuid().safeParse(req.headers['x-operation-id'])
      if (!operation.success) return sendProblem(reply, 'validation_failed')
      return applyCardChecklistPlan(contextFromRequest(req), req.actor!, operation.data, req.body)
    },
  )
  app.post(
    '/cards/assign-many',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => ({
            kind: 'department_managed',
            departmentId: r.actor?.departmentId ?? '',
          }),
        },
      },
      schema: { body: assignManySchema, response: { 200: workflowResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const operation = z.string().uuid().safeParse(req.headers['x-operation-id'])
      if (!operation.success) return sendProblem(reply, 'validation_failed')
      return assignMany(contextFromRequest(req), operation.data, req.body)
    },
  )
}

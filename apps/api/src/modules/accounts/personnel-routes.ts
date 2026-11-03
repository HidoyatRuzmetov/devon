import { personnelRecordSchema, personnelWriteSchema, personnelTemplate } from '@devon/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import { getPersonnelRecord, savePersonnelRecord } from './personnel-repo.js'

export const personnelRoutes: FastifyPluginAsyncZod = async (app) => {
  const permission = {
    action: 'read' as const,
    subject: () => ({ kind: 'authenticated' as const }),
  }
  app.get(
    '/personnel-record',
    {
      config: { permission },
      schema: {
        querystring: z.object({ ownerUserId: z.string().uuid().optional() }),
        response: { 200: personnelRecordSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      const result = await getPersonnelRecord(
        contextFromRequest(req),
        req.query.ownerUserId ?? req.actor!.userId,
      )
      return result ?? sendProblem(reply, 'not_found')
    },
  )
  app.put(
    '/personnel-record',
    {
      bodyLimit: 3_000_000,
      config: {
        permission: {
          action: 'update',
          subject: (req) => ({ kind: 'personal', ownerUserId: req.actor?.userId ?? '' }),
        },
      },
      schema: { body: personnelWriteSchema, response: { 200: personnelRecordSchema } },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!checkCsrf(req, reply)) return
      const ctx = contextFromRequest(req)
      if (!ctx.departmentId || ctx.viewAs) return sendProblem(reply, 'forbidden')
      const validation = personnelTemplate.validate(req.body.data)
      if (validation.errors.length)
        return sendProblem(reply, 'validation_failed', {
          errors: validation.errors.map((issue) => ({ path: issue.id, code: 'personnel_invalid' })),
        })
      const result = await savePersonnelRecord(ctx, req.body.data, req.body.version)
      return result ?? sendProblem(reply, 'conflict')
    },
  )
}

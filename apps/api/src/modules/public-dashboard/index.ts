import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { dashboardLinkSchema, publicDashboardSchema } from '@devon/contracts'
import { contextFromRequest } from '../work/context.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import * as repo from './repo.js'

const managed = (r: FastifyRequest) => ({
  kind: 'department_managed' as const,
  departmentId: (r.params as { departmentId: string }).departmentId,
})
const params = z.object({ departmentId: z.uuid() })
function context(req: FastifyRequest) {
  // Route permission checks this exact department; DB checks the current membership again.
  return {
    ...contextFromRequest(req),
    departmentId: (req.params as { departmentId: string }).departmentId,
    departmentRole: 'head' as const,
  }
}
const routes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Cache-Control', 'no-store')
    return payload
  })
  app.get(
    '/public-dashboard',
    {
      config: { permission: { public: true }, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        hide: true,
        querystring: z.object({}).strict(),
        response: { 200: publicDashboardSchema, 404: z.null() },
      },
    },
    async (req, reply) => {
      reply
        .header('Cache-Control', 'no-store')
        .header('Referrer-Policy', 'no-referrer')
        .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1]
      if (!token) return reply.code(404).send(null)
      const result = await repo.read(token)
      if (!result) return reply.code(404).send(null)
      return result
    },
  )
  app.get(
    '/departments/:departmentId/public-links',
    {
      config: { permission: { action: 'read', subject: managed } },
      schema: { params, response: { 200: z.array(dashboardLinkSchema) } },
    },
    async (req, reply) => {
      const result = await repo.list(context(req))
      if (!result) return sendProblem(reply, 'forbidden')
      return result
    },
  )
  app.post(
    '/departments/:departmentId/public-links',
    {
      config: {
        permission: { action: 'create', subject: managed },
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: {
        params,
        body: z
          .object({
            label: z.string().trim().min(1).max(80),
            days: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]),
          })
          .strict(),
        response: { 201: dashboardLinkSchema.extend({ token: z.string() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.create(context(req), req.body.label, req.body.days)
      if (result === 'limit') return sendProblem(reply, 'conflict')
      if (!result) return sendProblem(reply, 'forbidden')
      return reply.code(201).send(result)
    },
  )
  app.delete(
    '/departments/:departmentId/public-links/:id',
    {
      config: { permission: { action: 'delete', subject: managed } },
      schema: { params: params.extend({ id: z.uuid() }) },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (!(await repo.revoke(context(req), req.params.id))) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )
}
export default routes

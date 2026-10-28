import {
  personalCalendarBodySchema,
  personalCalendarListSchema,
  personalCalendarQuerySchema,
  personalCalendarUpdateSchema,
} from '@devon/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import { deleteCalendar, listCalendar, saveCalendar } from './calendar-repo.js'

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  const subject = (req: { actor: { userId: string } | null }) => ({
    kind: 'personal' as const,
    ownerUserId: req.actor?.userId ?? '',
  })
  const params = z.object({ id: z.string().uuid() })
  app.get(
    '/calendar',
    {
      config: { permission: { action: 'read', subject } },
      schema: {
        querystring: personalCalendarQuerySchema,
        response: { 200: personalCalendarListSchema },
      },
    },
    (req) => listCalendar(contextFromRequest(req), req.query.from, req.query.to),
  )
  app.post(
    '/calendar',
    {
      config: { permission: { action: 'create', subject } },
      schema: {
        body: personalCalendarBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (req.body.remindAt && Date.parse(req.body.remindAt) <= Date.now())
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'remindAt', code: 'future_required' }],
        })
      const saved = await saveCalendar(contextFromRequest(req), req.body)
      if (saved && 'error' in saved)
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'remindAt', code: 'future_required' }],
        })
      return reply.code(201).send(saved!)
    },
  )
  app.patch(
    '/calendar/:id',
    {
      config: { permission: { action: 'update', subject } },
      schema: {
        params,
        body: personalCalendarUpdateSchema,
        response: { 200: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const saved = await saveCalendar(
        contextFromRequest(req),
        req.body.entry,
        req.params.id,
        req.body.version,
      )
      if (!saved) return sendProblem(reply, 'conflict')
      if ('error' in saved)
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'remindAt', code: 'future_required' }],
        })
      return saved
    },
  )
  app.delete(
    '/calendar/:id',
    {
      config: { permission: { action: 'delete', subject } },
      schema: { params, querystring: z.object({ version: z.coerce.number().int().positive() }) },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (!(await deleteCalendar(contextFromRequest(req), req.params.id, req.query.version)))
        return sendProblem(reply, 'conflict')
      return reply.code(204).send()
    },
  )
}

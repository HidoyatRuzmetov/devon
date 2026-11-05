import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { contextFromRequest } from '../work/context.js'
import { acknowledgeCelebration, claimCelebration } from './repo.js'

export const birthdayRoutes: FastifyPluginAsyncZod = async (app) => {
  const permission = {
    action: 'update' as const,
    subject: (r: Parameters<typeof contextFromRequest>[0]) => ({
      kind: 'own_account' as const,
      userId: r.actor?.userId ?? '',
    }),
  }
  app.post(
    '/birthday/open',
    {
      config: { permission, rateLimit: { max: 8, timeWindow: '1 minute' } },
      schema: {
        body: z.object({ claimToken: z.uuid() }).strict(),
        response: {
          200: z.object({
            celebration: z
              .object({ date: z.iso.date(), message: z.string(), claimToken: z.uuid() })
              .nullable(),
          }),
        },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store')
      if (!checkCsrf(req, reply)) return
      return { celebration: await claimCelebration(contextFromRequest(req), req.body.claimToken) }
    },
  )
  app.post(
    '/birthday/seen',
    {
      config: { permission },
      schema: {
        body: z.object({ claimToken: z.uuid(), date: z.iso.date() }).strict(),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await acknowledgeCelebration(contextFromRequest(req), req.body.claimToken, req.body.date)
      return { ok: true }
    },
  )
}

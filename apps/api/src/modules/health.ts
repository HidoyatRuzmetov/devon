// GET /healthz, GET /readyz -- public, unauthenticated (design.md §1.7).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { readyzSchema } from '../schemas.js'

const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/healthz',
    {
      config: { permission: { public: true } },
      schema: { response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    async () => ({ status: 'ok' as const }),
  )

  app.get(
    '/readyz',
    {
      config: { permission: { public: true } },
      schema: { response: { 200: readyzSchema, 503: readyzSchema } },
    },
    async (_req, reply) => {
      const [db, migrations] = await Promise.all([
        app.devon.checkDbReady(),
        app.devon.checkMigrationsApplied(),
      ])
      // ADR-003: no Valkey session mirror in this epic; Valkey itself is only used for rate limiting
      // (design.md §0), which this item runs in-process without a Valkey dependency (out of this
      // item's TOUCHES/depends-on). Reported `true` here is "not a blocker for readiness in this
      // epic", not a claim that a Valkey connection was checked.
      const valkey = true
      const ok = db && migrations && valkey
      reply.code(ok ? 200 : 503).send({ db, valkey, migrations })
    },
  )
}

export default healthRoutes

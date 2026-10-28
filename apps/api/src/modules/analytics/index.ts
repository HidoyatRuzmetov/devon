// Own Home totals; the old department dashboard has been replaced by check-ins.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { contextFromRequest } from '../work/context.js'
import { getPersonalOverview } from './repo.js'
import { personalOverviewSchema } from './schemas.js'
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/personal',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'department_child', departmentId: r.actor?.departmentId ?? '' }),
        },
      },
      schema: { response: { 200: personalOverviewSchema } },
    },
    (req) => getPersonalOverview(contextFromRequest(req)),
  )
}
export default routes
export const prefix = '/analytics'

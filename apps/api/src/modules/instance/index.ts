// GET /api/v1/instance -- public (design.md §1.7). Exposes only `instance_settings.is_demo` and the
// other non-sensitive instance flags; the demo *seed* itself is EPIC-000.demo's job (this item's DOES
// NOT list).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { LOCALES, instancePublicSchema } from '../../schemas.js'

const instanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/instance',
    {
      config: { permission: { public: true } },
      schema: { response: { 200: instancePublicSchema } },
    },
    async (_req, reply) => {
      const [settings, userCount] = await Promise.all([
        app.devon.getInstanceSettings(),
        app.devon.countUsers(),
      ])
      reply.header('etag', `"instance-${userCount}-${settings.isDemo ? 1 : 0}"`)
      reply.header('cache-control', 'public, max-age=0, must-revalidate')
      return {
        isDemo: settings.isDemo,
        maintenance: settings.maintenance,
        registrationOpen: settings.registrationOpen,
        locales: [...LOCALES],
        defaultLocale: 'uz-Latn' as const,
        setupRequired: userCount === 0,
      }
    },
  )
}

export default instanceRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at exactly `/api/v1` (no extra segment) --
// `GET /instance` below becomes `GET /api/v1/instance`.
export const prefix = ''

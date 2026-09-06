// GET /api/v1/openapi.json -- public (design.md §1.7, I-19: public API responses are versioned and
// documented).
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

const openapiRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api/v1/openapi.json', { config: { permission: { public: true } } }, async () =>
    app.swagger(),
  )
}

export default openapiRoutes

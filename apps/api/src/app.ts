// Builds the Fastify app (design.md §1.7). `buildApp` takes its `Deps` and `Config` as parameters
// (never reads `process.env` itself) so a test can inject an in-memory fake and never touch Postgres
// (test/vitest.config.ts). `src/server.ts` is the only caller that wires the real, Postgres-backed
// `createRepo()` and `loadConfig(process.env)`.
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import type { Config } from './config.js'
import type { Deps } from './deps.js'
import sessionPlugin from './plugins/session.js'
import authorizePlugin from './plugins/authorize.js'
import healthRoutes from './modules/health.js'
import openapiRoutes from './modules/openapi.js'
import { loadApiModules } from './module-loader.js'

declare module 'fastify' {
  interface FastifyInstance {
    devon: Deps
    devonConfig: Config
  }
}

export async function buildApp(deps: Deps, config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    // Keep the route table exactly the OpenAPI path table in design.md §1.7 -- an auto-added HEAD
    // sibling for every GET would otherwise need its own, redundant `PUBLIC_ROUTES` entries.
    exposeHeadRoutes: false,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.decorate('devon', deps)
  app.decorate('devonConfig', config)

  // Every authenticated JSON response is `Cache-Control: private, no-store` (design.md §1.7
  // conventions); public endpoints (healthz/readyz/openapi/instance) opt out explicitly.
  app.addHook('onSend', async (req, reply, payload) => {
    if (!reply.getHeader('cache-control')) reply.header('cache-control', 'private, no-store')
    reply.header('x-request-id', req.id)
    return payload
  })

  // Registered before any child plugin: Fastify snapshots the error handler in effect at the moment a
  // child plugin is registered, so a `setErrorHandler` call made *after* `app.register(...)` for a
  // module is never inherited by that module's routes (verified empirically against fastify@5.12.3;
  // this is not documented behaviour worth relying on being fixed).
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      reply
        .code(422)
        .header('content-type', 'application/problem+json; charset=utf-8')
        .send({
          type: 'https://devon.local/problems/validation_failed',
          title: 'Validation Failed',
          status: 422,
          code: 'validation_failed',
          detail: 'The request did not pass validation.',
          errors: err.validation.map((v) => ({
            path: v.instancePath || v.schemaPath,
            code: v.keyword,
          })),
        })
      return
    }
    req.log.error(err)
    reply.code(500).header('content-type', 'application/problem+json; charset=utf-8').send({
      type: 'https://devon.local/problems/internal',
      title: 'Internal Server Error',
      status: 500,
      code: 'internal',
      detail: 'An unexpected error occurred.',
    })
  })

  await app.register(cookie)
  await app.register(rateLimit, { global: false })
  await app.register(swagger, {
    openapi: {
      info: { title: 'WorkPortal API', version: '0.0.0' },
      servers: [{ url: config.DEVON_PUBLIC_URL }],
    },
    transform: jsonSchemaTransform,
  })

  await app.register(sessionPlugin)
  await app.register(authorizePlugin)

  await app.register(healthRoutes)
  await app.register(openapiRoutes)

  // Every domain module under `src/modules/<name>/index.ts` -- discovered, not listed here, so a new
  // module never requires an edit to this file (MODULE-GUIDE.md "API modules"). `app.register()`
  // enqueues into Fastify's (avvio) boot queue synchronously, in call order, the instant it is
  // invoked -- `.map()` below calls it for every module in the loader's deterministic (alphabetical)
  // order before anything is awaited, so `Promise.all` here parallelises only the awaiting, never the
  // registration order itself.
  await Promise.all(
    (await loadApiModules()).map((mod) =>
      app.register(mod.plugin, { prefix: `/api/v1${mod.prefix}` }),
    ),
  )

  return app
}

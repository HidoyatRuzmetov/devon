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
import securityHeadersPlugin from './plugins/security-headers.js'
import csrfPlugin from './plugins/csrf-guard.js'
import storagePlugin, { type StorageOverrides } from './plugins/storage.js'
import { redactPaths, REDACTION_CENSOR } from './lib/log-redaction.js'
import { sendProblem } from './lib/problem-reply.js'
import healthRoutes from './modules/health.js'
import openapiRoutes from './modules/openapi.js'
import { loadApiModules } from './module-loader.js'
// EPIC-013 (admin module, TECH-SPEC §11 "pause switch" + §10 "pause a department"): the only other
// line this module needs outside its own folder, same precedent as `PUBLIC_ROUTES` in
// `plugins/authorize.ts` -- see `modules/admin/availability-gate.ts`'s header for the full reasoning.
import { registerAvailabilityGate } from './modules/admin/availability-gate.js'

declare module 'fastify' {
  interface FastifyInstance {
    devon: Deps
    devonConfig: Config
  }
}

export type BuildAppOptions = {
  /** Test seam for the storage plugin (a fake malware scanner, a fake object store). Production
   * (`server.ts`) never passes this: both are built from `Config` (`plugins/storage.ts`). */
  storage?: StorageOverrides
}

export async function buildApp(
  deps: Deps,
  config: Config,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    // H1.11: passwords, tokens, codes and contact blocks are censored inside pino's serializer, so
    // no call site can leak one by logging the wrong object (`lib/log-redaction.ts`).
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: redactPaths(), censor: REDACTION_CENSOR },
    },
    // H1.10/H17.1: Caddy terminates TLS and sets X-Forwarded-For/-Proto (infra/Caddyfile), so
    // `req.ip` is the real client (rate limits, audit rows) and `req.protocol` is `https` (HSTS).
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
    // H1.13/H16.1: the body is built by `@devon/contracts`'s `problem()` from its frozen table --
    // never hand-assembled here -- so a stack, a SQL fragment, a filesystem path or the offending
    // value can never reach a client, in any environment. `instance` carries the request id, which
    // is the only thread from what the user sees to what the server log holds (H15.1).
    const instance = `urn:devon:request:${req.id}`
    if (err.validation) {
      sendProblem(reply, 'validation_failed', {
        instance,
        errors: err.validation.map((v) => ({
          path: v.instancePath || v.schemaPath,
          code: v.keyword,
        })),
      })
      return
    }
    // A body past the route's `bodyLimit` (the storage plugin's raw image parser) is a client error
    // with a fixed shape, never a 500 -- and never the JSON-body 422 above either.
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      sendProblem(reply, 'validation_failed', {
        status: 413,
        instance,
        errors: [{ path: 'body', code: 'too_large' }],
      })
      return
    }
    req.log.error({ err }, 'unhandled error')
    sendProblem(reply, 'internal', { instance })
  })

  await app.register(cookie)
  await app.register(rateLimit, { global: false })
  // H1.10: helmet-equivalent headers, the CORS allow-list and the `Origin` guard, registered before
  // anything that can answer a request so even a 404 or a rate-limit 429 carries them.
  await app.register(securityHeadersPlugin)
  await app.register(swagger, {
    openapi: {
      info: { title: 'WorkPortal API', version: '0.0.0' },
      servers: [{ url: config.DEVON_PUBLIC_URL }],
    },
    transform: jsonSchemaTransform,
  })

  await app.register(sessionPlugin)
  // Between session (so `req.actor` exists) and authorize (so a maintenance/paused-department deny
  // short-circuits before `can()` ever runs, rather than racing it): `registerAvailabilityGate` calls
  // `app.addHook` directly on this exact instance, not `app.register(...)`, so it needs no plugin
  // encapsulation of its own.
  registerAvailabilityGate(app)
  await app.register(authorizePlugin)
  // After `authorizePlugin` so its 401/403 answers an unauthorised request before this hook turns it
  // into a CSRF 403, and before every route-registering plugin below (a Fastify hook only applies to
  // routes registered after it in the same encapsulation context): H1.4.
  await app.register(csrfPlugin)
  // After `authorizePlugin`: the storage plugin registers the local driver's two routes, and every
  // route must be seen by authorize's `onRoute` boot guard (plugins/authorize.ts).
  await app.register(storagePlugin, { ...(options.storage ? { overrides: options.storage } : {}) })

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

// Builds the Fastify app (design.md §1.7). `buildApp` takes its `Deps` and `Config` as parameters
// (never reads `process.env` itself) so a test can inject an in-memory fake and never touch Postgres
// (test/vitest.config.ts). `src/server.ts` is the only caller that wires the real, Postgres-backed
// `createRepo()` and `loadConfig(process.env)`.
import Fastify, { LogController, type FastifyError, type FastifyInstance } from 'fastify'
import compress from '@fastify/compress'
import cookie from '@fastify/cookie'
import etag from '@fastify/etag'
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
import jsonBodyPlugin from './plugins/json-body.js'
import storagePlugin, { type StorageOverrides } from './plugins/storage.js'
import { redactPaths, REDACTION_CENSOR } from './lib/log-redaction.js'
import { sendProblem } from './lib/problem-reply.js'
import healthRoutes from './modules/health.js'
import openapiRoutes from './modules/openapi.js'
import metricsRoutes from './modules/metrics.js'
import observabilityPlugin from './plugins/observability.js'
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
    // H15.1: `plugins/observability.ts`'s `onResponse` hook is this app's one structured access-log
    // line per request (request/user/department ids, route, status, duration) -- Fastify's own
    // default "incoming request"/"request completed" pair would otherwise double every request's log
    // volume with a line carrying none of that context. `logController` (not the top-level
    // `disableRequestLogging` option, deprecated as of fastify@5.12.3, removed in fastify@6) is the
    // currently-supported way to ask for this.
    logController: new LogController({ disableRequestLogging: true }),
    // H7.4: an explicit, reviewed default (Fastify's own undocumented default is already 1 MiB --
    // see `config.ts`'s `HTTP_BODY_LIMIT_BYTES` doc comment). The storage plugin's own upload routes
    // pass their own larger, per-route `bodyLimit` (`plugins/storage.ts`), which overrides this.
    // (The security package stated the same bound as a literal `1_048_576`; the env-overridable
    // `HTTP_BODY_LIMIT_BYTES` above is the same number with a name and a boot-time validation, so the
    // two H7.4 statements of this limit collapse into this one.)
    bodyLimit: config.HTTP_BODY_LIMIT_BYTES,
  }).withTypeProvider<ZodTypeProvider>()

  // H7.4 "limits on ... JSON depth" lives in `plugins/json-body.ts` (registered below, before any
  // route-adding plugin). Both hardening packages wrote a depth-bounded `application/json` parser;
  // Fastify allows exactly one per content type, so the surviving one is the plugin's -- it measures
  // depth on the raw text *before* `JSON.parse`, which is the step a deeply-nested body overflows the
  // stack in -- reading its ceiling from `config.JSON_MAX_DEPTH` (this file's own former parser) and
  // rejecting with `DEVON_JSON_TOO_DEEP`, which the error handler below turns into the 422 the
  // product's Problem contract uses for a body that fails validation.
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
    // H7.4: a JSON body nested past `JSON_MAX_DEPTH` (the content-type parser above) -- same shape
    // as the schema-validation 422 above, since from the caller's point of view this is exactly that:
    // a request body that didn't pass validation, just a structural check ahead of Zod's own.
    if (err.code === 'DEVON_JSON_TOO_DEEP') {
      reply
        .code(422)
        .header('content-type', 'application/problem+json; charset=utf-8')
        .send({
          type: 'https://devon.local/problems/validation_failed',
          title: 'Validation Failed',
          status: 422,
          code: 'validation_failed',
          detail: 'The request did not pass validation.',
          errors: [{ path: 'body', code: 'too_deep' }],
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
    // Every other transport-level client error -- a malformed JSON body, a body nested past
    // `MAX_JSON_DEPTH` (`plugins/json-body.ts`), an unsupported media type, a rate-limit refusal --
    // used to fall through to the 500 branch below, so the client was told the *server* had failed
    // when in fact its own request was at fault (and a monitoring alert fired for it). Reported with
    // the status the error carries and the same fixed Problem body: still no message, stack or path
    // from the underlying error reaches the client (H1.13).
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500
    if (status >= 400 && status < 500) {
      sendProblem(reply, status === 429 ? 'rate_limited' : 'validation_failed', {
        status,
        instance,
        ...(status === 429 ? {} : { errors: [{ path: 'body', code: 'invalid' }] }),
      })
      return
    }
    req.log.error({ err }, 'unhandled error')
    sendProblem(reply, 'internal', { instance })
  })

  // Before every route-registering plugin: the JSON parser must be in place when a route is added.
  await app.register(jsonBodyPlugin)
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

  // H2.5: an `ETag` computed from the actual response body on every GET (registered before
  // `compress` below -- Fastify's `onSend` hooks run in registration order, so the hash is taken of
  // the real payload, not of a particular request's negotiated encoding, which keeps the ETag stable
  // across `Accept-Encoding` values for the same content). `Cache-Control: private, no-store` (the
  // hook above) already stops a shared/browser HTTP cache from storing the response at all -- the
  // ETag here is for a caller that keeps its own last-seen value and sends `If-None-Match` itself
  // (TanStack Query's `meta`-driven revalidation, a Telegram Mini App poll, a CLI/script client), not
  // for browser-cache reuse. `ifNoneMatch: true` (the default) makes the plugin answer a matching
  // conditional GET with a bare `304` and no body -- exactly the bytes this item asks to save.
  await app.register(etag)
  // H2.1: brotli (preferred) or gzip on every compressible response over the plugin's own 1 KiB
  // default threshold -- `@fastify/compress`'s built-in `compressible` check already skips images,
  // video and already-compressed formats (avatars, uploaded attachments served by `storagePlugin`),
  // so this only ever touches the JSON/HTML/text this API actually returns.
  await app.register(compress, { global: true, encodings: ['br', 'gzip', 'deflate'] })

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
  await app.register(metricsRoutes)
  // H15.1: structured per-request logs (request/user/department ids, latency), the HTTP latency
  // histogram, and the slow-request log -- registered after every plugin above so its `onResponse`
  // hook runs with `req.actor` already resolved (`sessionPlugin`) and sees the final route/status.
  await app.register(observabilityPlugin)

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

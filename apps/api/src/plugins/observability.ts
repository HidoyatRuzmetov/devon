// H15.1: "structured JSON logs with request/user/department ids; latency histograms per route; ...
// error rates; ... a slow-request log". One `onResponse` hook is the single source for all four:
// Fastify's own pino logger already writes structured JSON (design.md's own logging choice), so this
// only needs to add the fields and the metric that per-request line was missing, not build a second
// logging pipeline. `app.ts` sets `disableRequestLogging: true` specifically so this hook's line is
// the only one per request, not an addition to Fastify's own pair.
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { httpRequestDuration, httpRequestsTotal, httpSlowRequestsTotal } from '../lib/metrics.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** `process.hrtime.bigint()` at `onRequest` -- monotonic, immune to a system clock step
     * (H15.1 latency numbers must never go negative or spike from an NTP adjustment mid-request). */
    devonStartHrtime?: bigint
  }
}

/** The registered route pattern (`/api/v1/work/cards/:id`), never the raw URL (`/api/v1/work/cards/
 * 7f3a...`) -- using the raw URL as a Prometheus/log label would make the label (and this histogram's
 * per-series memory, H11.1) grow without bound, one series per id ever requested. Fastify only
 * populates `routeOptions.url` once a route has matched; an unmatched request (404) falls back to a
 * single fixed label so it still gets exactly one bounded series, not one per garbage path someone
 * probed. */
function routeLabel(req: { routeOptions?: { url?: string | undefined }; url: string }): string {
  return req.routeOptions?.url ?? '__unmatched__'
}

export default fp(async function observabilityPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    req.devonStartHrtime = process.hrtime.bigint()
  })

  app.addHook('onResponse', async (req, reply) => {
    const startedAt = req.devonStartHrtime
    const durationMs = startedAt ? Number(process.hrtime.bigint() - startedAt) / 1e6 : 0
    const route = routeLabel(req)
    const method = req.method
    const status = String(reply.statusCode)

    httpRequestDuration.observe(durationMs / 1000, { method, route, status })
    httpRequestsTotal.inc({ method, route, status })

    // H15.1 "request/user/department ids": `req.actor` is resolved by `plugins/session.ts`'s
    // `preHandler`, which always runs before a route handler (and therefore before `onResponse`) --
    // `null` for an unauthenticated request, exactly like every other place this codebase reads it.
    const fields = {
      reqId: req.id,
      method,
      route,
      statusCode: reply.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: req.actor?.userId ?? null,
      departmentId: req.actor?.departmentId ?? null,
    }

    if (reply.statusCode >= 500) {
      req.log.error(fields, 'request completed with a server error')
    } else if (durationMs >= app.devonConfig.SLOW_REQUEST_MS) {
      httpSlowRequestsTotal.inc({ method, route })
      req.log.warn(fields, 'slow request')
    } else {
      req.log.info(fields, 'request completed')
    }
  })
})

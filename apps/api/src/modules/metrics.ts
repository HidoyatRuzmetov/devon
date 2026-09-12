// GET /metrics -- Prometheus text exposition (H15.1). `{ public: true }` (like `/healthz`/`/readyz`
// and `/api/v1/setup/:token`) because it must run before -- and without -- a session; it enforces its
// OWN access control (loopback-only unless `DEVON_METRICS_REMOTE=true`) exactly the way the setup
// route does, rather than the session-based `can()` check every authenticated route uses.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { isLoopbackPeer } from '../lib/net.js'
import { sendProblem } from '../lib/problem-reply.js'
import { circuitSnapshots } from '../lib/resilience/registry.js'
import { circuitBreakerState, registry } from '../lib/metrics.js'

const STATE_VALUE: Record<string, number> = { closed: 0, half_open: 1, open: 2 }

const metricsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/metrics',
    // No `schema.response` -- the body is raw Prometheus text exposition, not JSON, and this
    // codebase's serializer (`fastify-type-provider-zod`) only ever runs against a declared response
    // schema, exactly like the local storage driver's raw-bytes `GET .../objects` route
    // (`plugins/storage.ts`) also declares none for the same reason.
    { config: { permission: { public: true } } },
    async (req, reply) => {
      if (!app.devonConfig.DEVON_METRICS_REMOTE && !isLoopbackPeer(req)) {
        sendProblem(reply, 'forbidden')
        return
      }
      // Circuit breaker state is cheap to recompute on every scrape (a handful of gauges, no I/O) --
      // simpler and always-fresh, unlike the histograms/counters above which accumulate as requests
      // happen.
      for (const [name, snapshot] of Object.entries(circuitSnapshots())) {
        circuitBreakerState.set(STATE_VALUE[snapshot.state] ?? -1, { breaker: name })
      }
      reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      reply.send(registry.render())
    },
  )
}

export default metricsRoutes

// Response security headers, CORS allow-list and the browser-`Origin` guard (HARDENING H1.10, H1.4).
//
// Hand-rolled rather than `@fastify/helmet` on purpose: the header set below is helmet's own default
// set (helmet 8's `contentSecurityPolicy`, `hsts`, `noSniff`, `frameguard`, `referrerPolicy`,
// `crossOriginOpenerPolicy`, `crossOriginResourcePolicy`, `originAgentCluster`,
// `xPermittedCrossDomainPolicies`, `xDnsPrefetchControl`) plus `Permissions-Policy`, which helmet does
// not ship at all -- with no new dependency to pin, audit and keep patched (H1.12, H20.1), and with
// the one behaviour helmet cannot express: the values are computed from `Config`, so HSTS is only
// asserted for a deployment that actually terminates TLS (Caddy, TECH-SPEC §13) and never by a
// developer's `http://localhost` process.
//
// This API answers only `application/json` / `application/problem+json` (and one signed
// `Content-Disposition: attachment` object download, `plugins/storage.ts`) -- never HTML -- so its own
// CSP is the maximally restrictive `default-src 'none'`: an API response rendered as a document can
// load nothing at all. The *app shell's* CSP is a different policy on a different response and is set
// where that response is produced, by Caddy (`infra/Caddyfile`), because in production the SPA is
// static files Caddy serves directly and this process never sees that request.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Config } from '../config.js'
import { sendProblem } from '../lib/problem-reply.js'

/** RFC 9110 safe methods + `OPTIONS`: never state-changing, so never subject to the `Origin` guard. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

/** The API's own CSP. It serves no HTML, so nothing may load from anywhere; `frame-ancestors 'none'`
 * is the standards-track half of `X-Frame-Options: DENY` (both are sent -- the header for pre-CSP2
 * user agents, the directive for everything current). */
const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; " +
  "script-src 'none'; style-src 'none'; img-src 'none'; sandbox"

/** Every powerful browser feature this product does not use, switched off for the whole origin.
 * `fullscreen=(self)` is the one exception: the canvas and the analytics charts use it. */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'battery=()',
  'camera=()',
  'display-capture=()',
  'document-domain=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ')

const HSTS = 'max-age=31536000; includeSubDomains; preload'

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** `http://localhost:5173`, `http://127.0.0.1:4173`, `http://[::1]:3000` -- any port. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}

/**
 * The CORS/`Origin` allow-list: exactly the origin of `DEVON_PUBLIC_URL` (the one origin the app is
 * served from), plus anything `DEVON_ALLOWED_ORIGINS` names explicitly. Never `*`, never a reflected
 * arbitrary origin.
 */
export function buildAllowedOrigins(config: Config): ReadonlySet<string> {
  const origins = new Set<string>()
  const publicOrigin = originOf(config.DEVON_PUBLIC_URL)
  if (publicOrigin) origins.add(publicOrigin)
  for (const raw of config.DEVON_ALLOWED_ORIGINS.split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const parsed = originOf(trimmed)
    if (parsed) origins.add(parsed)
  }
  return origins
}

/**
 * Outside production, any loopback origin is also allowed. This is not a weakening of the production
 * control -- it is the only way the dev topology can work at all: Vite proxies `/api/*` to this
 * process with `changeOrigin: true` (`apps/web/src/vite.config.ts`), which rewrites `Host` to the API's
 * own `127.0.0.1:<API_PORT>` but forwards the browser's `Origin` (`http://127.0.0.1:<WEB_PORT>`)
 * untouched, so the two never match on a developer machine or in Playwright. With
 * `NODE_ENV=production` the set is exactly `buildAllowedOrigins()` and nothing else.
 */
export function isOriginAllowed(
  origin: string,
  allowed: ReadonlySet<string>,
  isProduction: boolean,
): boolean {
  if (allowed.has(origin)) return true
  return !isProduction && isLoopbackOrigin(origin)
}

function applyStaticHeaders(reply: FastifyReply, isProduction: boolean, isHttps: boolean): void {
  reply.header('content-security-policy', API_CSP)
  reply.header('x-content-type-options', 'nosniff')
  reply.header('x-frame-options', 'DENY')
  reply.header('referrer-policy', 'no-referrer')
  reply.header('permissions-policy', PERMISSIONS_POLICY)
  reply.header('cross-origin-opener-policy', 'same-origin')
  reply.header('cross-origin-resource-policy', 'same-origin')
  reply.header('origin-agent-cluster', '?1')
  reply.header('x-dns-prefetch-control', 'off')
  reply.header('x-permitted-cross-domain-policies', 'none')
  // Asserting HSTS from a plain-http developer process would pin `localhost` to https in that
  // browser profile for a year -- a real, reported foot-gun. Only a TLS-terminated deployment
  // (Caddy sets `X-Forwarded-Proto: https`, `trustProxy` makes `req.protocol` reflect it) gets it.
  if (isProduction || isHttps) reply.header('strict-transport-security', HSTS)
}

export default fp(async function securityHeadersPlugin(app: FastifyInstance) {
  const config = app.devonConfig
  const isProduction = config.NODE_ENV === 'production'
  const allowedOrigins = buildAllowedOrigins(config)

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    applyStaticHeaders(reply, isProduction, req.protocol === 'https')

    const origin = req.headers.origin
    const originAllowed =
      typeof origin === 'string' &&
      origin !== 'null' &&
      isOriginAllowed(origin, allowedOrigins, isProduction)

    if (typeof origin === 'string') {
      // `Vary: Origin` even when the origin is refused: the answer genuinely differs per origin, and
      // a shared cache must never reuse one origin's response for another.
      reply.header('vary', 'origin')
      if (originAllowed) {
        reply.header('access-control-allow-origin', origin)
        reply.header('access-control-allow-credentials', 'true')
      }
    }

    if (req.method === 'OPTIONS') {
      // No route in this API is registered for OPTIONS (`design.md §1.7`'s path table is the whole
      // route table), so a CORS preflight would otherwise 404 through the `onRoute` boot guard's
      // world. Answered here, before routing, and only for an allow-listed origin.
      if (!originAllowed) {
        reply.code(403).send()
        return reply
      }
      reply
        .header('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE')
        .header('access-control-allow-headers', 'content-type, x-csrf-token, accept')
        .header('access-control-max-age', '600')
        .code(204)
        .send()
      return reply
    }

    // H1.4 defence in depth, in front of the double-submit token check (`lib/csrf.ts`): a
    // state-changing request whose browser-set `Origin` is not the app's own is refused outright.
    // A request with no `Origin` at all (curl, the Telegram webhook, a server-to-server caller) is
    // not refused here -- it is refused by the CSRF token check instead, which every such caller
    // that carries a session cookie must still pass.
    if (!SAFE_METHODS.has(req.method) && typeof origin === 'string' && !originAllowed) {
      sendProblem(reply, 'forbidden')
      return reply
    }
    return undefined
  })
})

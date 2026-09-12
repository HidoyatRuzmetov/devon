// POST /api/v1/setup/{token} -- public, loopback-gated (design.md §1.7, AC-12).
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { setupBodySchema, setupResultSchema } from '../../schemas.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { toPublicUser } from '../../lib/user-view.js'

/** Checks the real TCP peer, never `X-Forwarded-For` -- `app.ts` sets `trustProxy: true` for
 * client-ip logging elsewhere, but a security gate must not trust a header an attacker controls when
 * there is no real reverse proxy stripping it (design.md §4(m) makes the identical point about the
 * sentinel). */
function isLoopbackPeer(req: FastifyRequest): boolean {
  const addr = req.socket.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

const setupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/setup/:token',
    {
      config: { permission: { public: true } },
      schema: { body: setupBodySchema, response: { 201: setupResultSchema } },
    },
    async (req, reply) => {
      if (!app.devonConfig.DEVON_SETUP_REMOTE && !isLoopbackPeer(req)) {
        // Same 410 shape as an already-consumed token (design.md §6.3: "one identical screen") --
        // nothing about a remote caller learns whether a token exists at all.
        sendProblem(reply, 'gone')
        return
      }

      const { token } = req.params as { token: string }
      const result = await app.devon.consumeSetupToken(token, req.body, {
        requestId: req.id,
        userId: null,
        actorRole: null,
        actingForUserId: null,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
      })
      if (!result.ok) {
        sendProblem(reply, 'gone')
        return
      }
      return reply.code(201).send({ user: toPublicUser(result.user) })
    },
  )
}

export default setupRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1` -- `POST /setup/:token` below
// becomes `POST /api/v1/setup/:token`.
export const prefix = ''

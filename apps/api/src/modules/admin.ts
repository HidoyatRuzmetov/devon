// /api/v1/admin/* -- super_admin only (design.md §3.4, AC-11). `setNotFoundHandler`, registered inside
// this encapsulated plugin, applies only to unmatched paths under this prefix (Fastify scopes
// `notFoundHandler` to the encapsulation context it is set in) and calls the exact same
// `denyForSubject` the matched routes' global `preHandler` uses -- the only way two different code
// paths (a real route's preHandler vs. a 404 handler) can be guaranteed to emit byte-identical bodies.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { denyForSubject } from '../plugins/authorize.js'
import { sendProblem } from '../lib/problem-reply.js'
import { adminInstanceSchema, chainVerificationSchema } from '../schemas.js'

const adminPlugin: FastifyPluginAsyncZod = async (app) => {
  const instanceSubject = () => ({ kind: 'instance' as const })

  app.get(
    '/instance',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: adminInstanceSchema } },
    },
    async () => {
      const [settings, userCount] = await Promise.all([
        app.devon.getInstanceSettings(),
        app.devon.countUsers(),
      ])
      return { isDemo: settings.isDemo, registrationOpen: settings.registrationOpen, userCount }
    },
  )

  app.get(
    '/audit/verify',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: chainVerificationSchema } },
    },
    async () => {
      const result = await app.devon.verifyAuditChain()
      return {
        ok: result.ok,
        checkedFrom: 1,
        checkedTo: null,
        rows: result.rowsChecked,
        firstBadSeq: result.firstBadSeq,
        failure: result.failure,
      }
    },
  )

  app.setNotFoundHandler(async (req, reply) => {
    const allowed = await denyForSubject(req, reply, 'administer', { kind: 'instance' })
    if (!allowed) return
    sendProblem(reply, 'not_found')
  })
}

export default adminPlugin

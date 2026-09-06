// GET /api/v1/me, PATCH /api/v1/me -- design.md §1.7. `own_account` (I-1/I-7): only the signed-in user
// themselves, never a head, never the super admin, ever.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { meSchema, patchMeSchema } from '../schemas.js'
import { checkCsrf } from '../lib/csrf.js'
import { CSRF_COOKIE_NAME } from '../lib/cookies.js'
import { requestIp, requestUserAgent } from '../plugins/session.js'
import { toPublicUser } from '../lib/user-view.js'
import type { UserRecord } from '../types.js'

function toMe(user: UserRecord, isDemo: boolean, csrfToken: string) {
  return {
    user: toPublicUser(user),
    memberships: [], // EPIC-002 populates this; no `app.memberships` rows can exist yet in this epic.
    membershipCount: 0,
    activeDepartmentId: null,
    actingForUserId: null,
    instance: { isDemo, maintenance: false },
    csrfToken,
  }
}

const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'own_account', userId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: meSchema } },
    },
    async (req, reply) => {
      const settings = await app.devon.getInstanceSettings()
      const csrfToken = req.cookies[CSRF_COOKIE_NAME] ?? ''
      reply.send(toMe(req.actorUser!, settings.isDemo, csrfToken))
    },
  )

  app.patch(
    '/me',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'own_account', userId: r.actor?.userId ?? '' }),
        },
      },
      schema: { body: patchMeSchema, response: { 200: meSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return

      const updated = await app.devon.updateUserProfile(req.actorUser!.id, req.body, {
        requestId: req.id,
        userId: req.actor!.userId,
        actorRole: req.actor!.role,
        actingForUserId: null,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
      })
      const settings = await app.devon.getInstanceSettings()
      const csrfToken = req.cookies[CSRF_COOKIE_NAME] ?? ''
      reply.send(toMe(updated, settings.isDemo, csrfToken))
    },
  )
}

export default meRoutes

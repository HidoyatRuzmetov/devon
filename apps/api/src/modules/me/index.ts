// GET /api/v1/me, PATCH /api/v1/me -- design.md §1.7. `own_account` (I-1/I-7): only the signed-in user
// themselves, never a head, never the super admin, ever.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { meSchema, patchMeSchema } from '../../schemas.js'
import { checkCsrf } from '../../lib/csrf.js'
import { CSRF_COOKIE_NAME } from '../../lib/cookies.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { toPublicUser } from '../../lib/user-view.js'
import type { MembershipRecord, UserRecord } from '../../types.js'

// Real memberships via `Deps.listActiveMembershipsForUser` -- the same call `plugins/session.ts`'s
// `buildActor` makes for `req.actor.memberships`, run again here because the response also needs each
// department's display `name`, which `Actor.memberships` deliberately does not carry (permissions.ts's
// `Membership` type is `{ departmentId, role }` only).
function toMe(
  user: UserRecord,
  memberships: readonly MembershipRecord[],
  isDemo: boolean,
  csrfToken: string,
  viewAsDepartmentId: string | null,
) {
  return {
    user: toPublicUser(user),
    memberships: memberships.map((m) => ({
      departmentId: m.departmentId,
      name: m.departmentName,
      role: m.role,
    })),
    membershipCount: memberships.length,
    // No "switch department" endpoint yet (MODULE-GUIDE.md "Web features"): the first membership
    // (`joined_at` ascending, `listActiveMembershipsForUser`'s own order) is as good a default as any
    // until one exists -- `useDepartment()`'s client-side override still wins in the browser for
    // anyone who has picked a different one (`activeDepartmentId` here only seeds that resolution
    // order's first candidate).
    //
    // Blitz integration fix: a super admin's own `memberships` is always empty (I-8b: super_admin is
    // an instance-wide role, never also a department membership), so without this the field was always
    // `null` while "viewing as" a department -- `useDepartment()` (`apps/web/src/lib/session.ts`)
    // resolves `serverActiveId ?? override ?? memberships[0] ?? null`, and with `memberships` empty its
    // `override` branch can never match either (`memberships.some(...)` is vacuously false), so every
    // screen that reads `useDepartment()` to know which department it is looking at saw `null` and had
    // nothing to render, even once `plugins/session.ts`'s matching fix let the actual API calls
    // through. `viewAsDepartmentId` (from `req.actor.viewAs`, set only for a super_admin who started
    // view-as, TECH-SPEC §10/I-8a) takes the same precedence a real membership already gets.
    activeDepartmentId: viewAsDepartmentId ?? memberships[0]?.departmentId ?? null,
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
      const [settings, memberships] = await Promise.all([
        app.devon.getInstanceSettings(),
        app.devon.listActiveMembershipsForUser(req.actorUser!.id),
      ])
      const csrfToken = req.cookies[CSRF_COOKIE_NAME] ?? ''
      reply.send(
        toMe(
          req.actorUser!,
          memberships,
          settings.isDemo,
          csrfToken,
          req.actor?.viewAs?.departmentId ?? null,
        ),
      )
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
      const [settings, memberships] = await Promise.all([
        app.devon.getInstanceSettings(),
        app.devon.listActiveMembershipsForUser(updated.id),
      ])
      const csrfToken = req.cookies[CSRF_COOKIE_NAME] ?? ''
      reply.send(
        toMe(
          updated,
          memberships,
          settings.isDemo,
          csrfToken,
          req.actor?.viewAs?.departmentId ?? null,
        ),
      )
    },
  )
}

export default meRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1` -- `GET /me` below becomes
// `GET /api/v1/me`.
export const prefix = ''

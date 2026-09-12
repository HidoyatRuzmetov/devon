// GET /api/v1/me, PATCH /api/v1/me -- design.md §1.7. `own_account` (I-1/I-7): only the signed-in user
// themselves, never a head, never the super admin, ever.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { meSchema, patchMeSchema } from '../../schemas.js'
import {
  ACTIVE_DEPARTMENT_COOKIE_NAME,
  activeDepartmentCookieOptions,
  signActiveDepartmentCookie,
} from '../../lib/active-department.js'
import { checkCsrf } from '../../lib/csrf.js'
import { CSRF_COOKIE_NAME } from '../../lib/cookies.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { sendProblem } from '../../lib/problem-reply.js'
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
  activeDepartmentId: string | null,
) {
  return {
    user: toPublicUser(user),
    memberships: memberships.map((m) => ({
      departmentId: m.departmentId,
      name: m.departmentName,
      role: m.role,
    })),
    membershipCount: memberships.length,
    // v1.1 SPEC §2.3: this is now the *server's* answer, resolved per request from the signed
    // `devon_dept` cookie (`plugins/session.ts` -> `buildActor`) and falling back to the first
    // membership by `joined_at`. The client no longer overrides it -- `useDepartment()` reads this
    // field and `POST /me/active-department` is how it changes, so the department a screen renders
    // and the department `can()` decided against are the same one.
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
    activeDepartmentId:
      viewAsDepartmentId ?? activeDepartmentId ?? memberships[0]?.departmentId ?? null,
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
          subject: (r) => ({
            kind: 'own_account',
            userId: r.actor?.userId ?? '',
          }),
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
      return reply.send(
        toMe(
          req.actorUser!,
          memberships,
          settings.isDemo,
          csrfToken,
          req.actor?.viewAs?.departmentId ?? null,
          req.actor?.departmentId ?? null,
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
          subject: (r) => ({
            kind: 'own_account',
            userId: r.actor?.userId ?? '',
          }),
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
      return reply.send(
        toMe(
          updated,
          memberships,
          settings.isDemo,
          csrfToken,
          req.actor?.viewAs?.departmentId ?? null,
          req.actor?.departmentId ?? null,
        ),
      )
    },
  )

  // v1.1 SPEC §2.3 -- the department switcher. `{kind:'own_account'}` because choosing which of YOUR
  // OWN memberships is active is an account preference, not a department action: a member may switch,
  // a head may switch, and neither gains anything by doing so (the target must already be one of
  // `actor.memberships`, and every route still runs `can()` against the department that results).
  app.post(
    '/me/active-department',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'own_account',
            userId: r.actor?.userId ?? '',
          }),
        },
      },
      schema: {
        body: z.object({ departmentId: z.string().uuid() }).strict(),
        response: { 200: meSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return

      const { departmentId } = req.body
      const memberships = await app.devon.listActiveMembershipsForUser(req.actorUser!.id)
      // Fail-closed: a department the user is not an active member of is a 403, never a silent
      // no-op, so the switcher cannot be used to probe which department ids exist.
      if (!memberships.some((m) => m.departmentId === departmentId)) {
        sendProblem(reply, 'forbidden')
        return
      }

      const { value } = signActiveDepartmentCookie(
        req.actorUser!.id,
        departmentId,
        app.devonConfig.CSRF_SECRET,
      )
      reply.setCookie(ACTIVE_DEPARTMENT_COOKIE_NAME, value, activeDepartmentCookieOptions())

      const settings = await app.devon.getInstanceSettings()
      const csrfToken = req.cookies[CSRF_COOKIE_NAME] ?? ''
      return reply.send(
        toMe(
          req.actorUser!,
          memberships,
          settings.isDemo,
          csrfToken,
          req.actor?.viewAs?.departmentId ?? null,
          departmentId,
        ),
      )
    },
  )
}

export default meRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1` -- `GET /me` below becomes
// `GET /api/v1/me`.
export const prefix = ''

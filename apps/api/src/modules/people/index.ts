// People (v1.1 SPEC §4 and §6): the indicator service behind the head's table, the saved views that
// table is arranged by, the person page, and the audited CSV export. Auto-discovered by
// `apps/api/src/module-loader.ts` (MODULE-GUIDE.md "API modules"); mounted at `/api/v1/people`.
//
// Head-only by subject kind, not by a check inside the handler: `{kind:'department_managed'}` is what
// "a column of everyone's overdue count is a management view" (PERMISSIONS-AUDIT §4.13) means in
// code, and `can()` decides it before this file runs. A member asking gets the same byte-identical
// 403 every other head-only route sends.
//
// The one route with two subjects is the person page: `/people/me/...` is `{kind:'own_account'}` (a
// xodim reading their own page, SPEC §6) and `/people/<uuid>/...` is `{kind:'department_managed'}`.
// The branch is on the *path*, never on the actor, so `resolveSubjectKind`'s boot-time probe
// (`plugins/authorize.ts`) sees a stable answer and the head-only allow-list stays honest.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import type { RequestContext } from '@devon/db'
import {
  INDICATORS,
  indicatorsVisibleTo,
  isIndicatorKey,
  normalizePeopleViewConfig,
  type IndicatorKey,
} from '@devon/contracts'
import { contextDepartmentRole, isHeadOf } from '../../lib/actor.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import * as service from './service.js'
import * as personRepo from './person-repo.js'
import * as viewsRepo from './views-repo.js'
import { peopleCsv } from './csv.js'
import {
  createPeopleViewBodySchema,
  exportQuerySchema,
  indicatorsQuerySchema,
  indicatorsResponseSchema,
  patchPeopleViewBodySchema,
  peopleViewDtoSchema,
  peopleViewListSchema,
  personActivitySchema,
  personCardsQuerySchema,
  personCardsSchema,
  personOverviewSchema,
  personParamsSchema,
  registryResponseSchema,
  viewIdParamsSchema,
} from './schemas.js'
import { INDICATOR_REGISTRY_DTO } from './schemas.js'

function activeDepartmentId(req: FastifyRequest): string {
  return req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? ''
}

function toDbContext(req: FastifyRequest): RequestContext {
  const departmentId = activeDepartmentId(req)
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    departmentId,
    // Needed by `app.focus_minutes_by_user`, which refuses anyone who is not this department's head.
    departmentRole: contextDepartmentRole(req.actor, departmentId),
    actingForUserId: null,
    viewAs: req.actor?.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

/** Comma-separated list -> array, trimmed, deduped, empty-safe. `?ids=` / `?keys=` are both optional:
 * omitting `ids` means every active member, omitting `keys` means the whole registry. */
function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

/** `/people/me/...` -> the caller's own id. Any other value is already a uuid (Zod checked it). */
function targetUserId(req: FastifyRequest & { params: { userId: string } }): string {
  return req.params.userId === 'me' ? (req.actor?.userId ?? '') : req.params.userId
}

const peopleRoutes: FastifyPluginAsyncZod = async (app) => {
  const departmentManagedSubject = (r: FastifyRequest) => ({
    kind: 'department_managed' as const,
    departmentId: activeDepartmentId(r),
  })

  /** SPEC §6: a member may open exactly one person page -- their own. The path segment decides, so
   * the boot-time probe (`params: {}`) always resolves to the head-only kind and the head-only
   * allow-list test still sees this route for what it mostly is. */
  const personSubject = (r: FastifyRequest) => {
    const params = r.params as { userId?: string } | undefined
    if (params?.userId === 'me') {
      return { kind: 'own_account' as const, userId: r.actor?.userId ?? '' }
    }
    return { kind: 'department_managed' as const, departmentId: activeDepartmentId(r) }
  }

  /** The registry itself: label keys, types, formats, descriptions, head-only flags. Served so the
   * column picker and the person page never hard-code a list that could drift from the server's. */
  app.get(
    '/indicators/registry',
    {
      config: {
        permission: { action: 'read', subject: departmentManagedSubject },
      },
      schema: { response: { 200: registryResponseSchema } },
    },
    async () => ({ indicators: INDICATOR_REGISTRY_DTO }),
  )

  app.get(
    '/indicators',
    {
      config: {
        permission: { action: 'read', subject: departmentManagedSubject },
      },
      schema: {
        querystring: indicatorsQuerySchema,
        response: { 200: indicatorsResponseSchema },
      },
    },
    async (req) => {
      const departmentId = activeDepartmentId(req)
      const userIds = splitList(req.query.ids)
      const keys = splitList(req.query.keys).filter((k): k is IndicatorKey => isIndicatorKey(k))
      const people = await service.getIndicators(toDbContext(req), {
        departmentId,
        userIds,
        keys,
      })
      return {
        // `IndicatorValue` allows a `readonly string[]` (a list indicator); the wire schema is a
        // plain array, so the copy here is the one place the two meet.
        people: people.map((person) => ({
          userId: person.userId,
          values: Object.fromEntries(
            Object.entries(person.values).map(
              ([key, value]): [string, string | number | boolean | string[] | null] => [
                key,
                Array.isArray(value)
                  ? [...value]
                  : ((value ?? null) as string | number | boolean | null),
              ],
            ),
          ),
        })),
        capacityCards: service.DEFAULT_WEEKLY_CARD_CAPACITY,
      }
    },
  )

  // -- Saved views (SPEC §4.3) ---------------------------------------------------------------------

  app.get(
    '/views',
    {
      config: { permission: { action: 'read', subject: departmentManagedSubject } },
      schema: { response: { 200: peopleViewListSchema } },
    },
    async (req) => ({
      views: await viewsRepo.listViews(toDbContext(req), activeDepartmentId(req)),
    }),
  )

  app.post(
    '/views',
    {
      config: { permission: { action: 'create', subject: departmentManagedSubject } },
      schema: { body: createPeopleViewBodySchema, response: { 201: peopleViewDtoSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await viewsRepo.createView(
        toDbContext(req),
        activeDepartmentId(req),
        req.actor!.userId,
        {
          name: req.body.name,
          config: normalizePeopleViewConfig(req.body.config),
          shared: req.body.shared,
          makeDepartmentDefault: req.body.makeDepartmentDefault,
        },
      )
      if (!outcome.ok) return sendProblem(reply, outcomeProblem(outcome.reason))
      return reply.code(201).send(outcome.view)
    },
  )

  app.patch(
    '/views/:id',
    {
      config: { permission: { action: 'update', subject: departmentManagedSubject } },
      schema: {
        params: viewIdParamsSchema,
        body: patchPeopleViewBodySchema,
        response: { 200: peopleViewDtoSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await viewsRepo.patchView(
        toDbContext(req),
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
        {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.config !== undefined
            ? { config: normalizePeopleViewConfig(req.body.config) }
            : {}),
          ...(req.body.shared !== undefined ? { shared: req.body.shared } : {}),
          ...(req.body.makeDepartmentDefault !== undefined
            ? { makeDepartmentDefault: req.body.makeDepartmentDefault }
            : {}),
          version: req.body.version,
        },
      )
      if (!outcome.ok) return sendProblem(reply, outcomeProblem(outcome.reason))
      return reply.send(outcome.view)
    },
  )

  app.delete(
    '/views/:id',
    {
      config: { permission: { action: 'delete', subject: departmentManagedSubject } },
      schema: { params: viewIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const { ok } = await viewsRepo.deleteView(
        toDbContext(req),
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  // -- CSV export (SPEC §4.3 "CSV export (audited)") -----------------------------------------------

  app.get(
    '/export.csv',
    {
      config: { permission: { action: 'read', subject: departmentManagedSubject } },
      schema: { querystring: exportQuerySchema },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      const ctx = toDbContext(req)
      const userIds = splitList(req.query.ids)
      const requested = splitList(req.query.keys).filter((k): k is IndicatorKey =>
        isIndicatorKey(k),
      )
      const keys: IndicatorKey[] =
        requested.length > 0 ? requested : INDICATORS.map((indicator) => indicator.id)
      const [names, people] = await Promise.all([
        service.getNames(ctx, departmentId, userIds),
        service.getIndicators(ctx, { departmentId, userIds, keys }),
      ])
      const csv = peopleCsv(names, people, keys)
      // SPEC §4.3: the export is audited, because a spreadsheet of everyone's numbers leaving the
      // product is exactly the kind of read a department should be able to account for later.
      await service.auditExport(ctx, departmentId, { rows: people.length, keys })
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('cache-control', 'private, no-store')
        .header('content-disposition', 'attachment; filename="xodimlar.csv"')
        .send(csv)
    },
  )

  // -- Person page (SPEC §6) -----------------------------------------------------------------------

  app.get(
    '/:userId/overview',
    {
      config: { permission: { action: 'read', subject: personSubject } },
      schema: { params: personParamsSchema, response: { 200: personOverviewSchema } },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      const userId = targetUserId(req as never)
      if (!userId) return sendProblem(reply, 'not_found')
      const isHead = isHeadOf(req.actor, departmentId)
      const ctx = toDbContext(req)

      const overview = await personRepo.personOverview(ctx, departmentId, userId, {
        includeTelegramLink: isHead,
        weeks: 12,
      })
      if (!overview) return sendProblem(reply, 'not_found')

      // Indicator values narrowed to what this viewer may read about this person: a head sees the
      // registry, a member reading their own page sees the four directory facts plus their own work
      // numbers (which are, by definition, about themselves).
      const visible = indicatorsVisibleTo(isHead || userId === req.actor?.userId).map((i) => i.id)
      const [values] = await service.getIndicators(ctx, {
        departmentId,
        userIds: [userId],
        keys: visible,
      })
      const indicators: Record<string, number | string | boolean | null> = {}
      for (const [key, value] of Object.entries(values?.values ?? {})) {
        indicators[key] = Array.isArray(value) ? value.join(', ') : ((value ?? null) as never)
      }

      return reply.send({
        ...overview,
        indicators,
        capacityCards: service.DEFAULT_WEEKLY_CARD_CAPACITY,
        canManage: isHead,
      })
    },
  )

  app.get(
    '/:userId/cards',
    {
      config: { permission: { action: 'read', subject: personSubject } },
      schema: {
        params: personParamsSchema,
        querystring: personCardsQuerySchema,
        response: { 200: personCardsSchema },
      },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      const userId = targetUserId(req as never)
      if (!userId) return sendProblem(reply, 'not_found')
      const cards = await service.personCards(toDbContext(req), departmentId, userId, {
        role: req.query.role,
        status: req.query.status,
        limit: req.query.limit,
      })
      return reply.send({ cards })
    },
  )

  app.get(
    '/:userId/activity',
    {
      config: { permission: { action: 'read', subject: personSubject } },
      schema: { params: personParamsSchema, response: { 200: personActivitySchema } },
    },
    async (req, reply) => {
      const departmentId = activeDepartmentId(req)
      const userId = targetUserId(req as never)
      if (!userId) return sendProblem(reply, 'not_found')
      const entries = await service.personActivity(toDbContext(req), departmentId, userId, 60)
      return reply.send({ entries })
    },
  )
}

function outcomeProblem(reason: 'not_found' | 'cap_reached' | 'conflict') {
  if (reason === 'not_found') return 'not_found' as const
  if (reason === 'conflict') return 'conflict' as const
  return 'validation_failed' as const
}

export default peopleRoutes

export const prefix = '/people'

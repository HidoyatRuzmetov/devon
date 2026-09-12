// People indicators (v1.1 SPEC §4.2) -- the one service behind the people table's dynamic columns,
// the person page's KPI tiles and the head's management dashboard. Auto-discovered by
// `apps/api/src/module-loader.ts` (MODULE-GUIDE.md "API modules"); mounted at `/api/v1/people`.
//
// Head-only by subject kind, not by a check inside the handler: `{kind:'department_managed'}` is what
// "a column of everyone's overdue count is a management view" (PERMISSIONS-AUDIT §4.13) means in
// code, and `can()` decides it before this file runs. A member asking gets the same byte-identical
// 403 every other head-only route sends.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import type { RequestContext } from '@devon/db'
import { isIndicatorKey, type IndicatorKey } from '@devon/contracts'
import { contextDepartmentRole } from '../../lib/actor.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import * as service from './service.js'
import { indicatorsQuerySchema, indicatorsResponseSchema, registryResponseSchema } from './schemas.js'
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
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

const peopleRoutes: FastifyPluginAsyncZod = async (app) => {
  const departmentManagedSubject = (r: FastifyRequest) => ({
    kind: 'department_managed' as const,
    departmentId: activeDepartmentId(r),
  })

  /** The registry itself: label keys, types, formats, descriptions, head-only flags. Served so the
   * column picker and the person page never hard-code a list that could drift from the server's. */
  app.get(
    '/indicators/registry',
    {
      config: { permission: { action: 'read', subject: departmentManagedSubject } },
      schema: { response: { 200: registryResponseSchema } },
    },
    async () => ({ indicators: INDICATOR_REGISTRY_DTO }),
  )

  app.get(
    '/indicators',
    {
      config: { permission: { action: 'read', subject: departmentManagedSubject } },
      schema: { querystring: indicatorsQuerySchema, response: { 200: indicatorsResponseSchema } },
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
                Array.isArray(value) ? [...value] : ((value ?? null) as string | number | boolean | null),
              ],
            ),
          ),
        })),
        capacityCards: service.DEFAULT_WEEKLY_CARD_CAPACITY,
      }
    },
  )
}

export default peopleRoutes

export const prefix = '/people'

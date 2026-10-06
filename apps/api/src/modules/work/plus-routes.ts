// v1.1 SPEC §7 -- the work-plus routes: dependencies, estimates and the light time log, recurring
// cards, templates, the multitask toolbar, the workload grid, the focus list, reminders, per-person
// capacity and the department's goals.
//
// Registered by `index.ts` with a plain call on the same Fastify instance (never a nested
// `app.register`), so every route here is seen by the root `onRoute` permission guard exactly like
// the v1.0 card routes -- a route that forgot its `config.permission` would still fail at boot.
//
// Two rules hold throughout, and they are the reason this file is long rather than clever:
//  1. **The server decides.** Every head-only surface declares `{kind:'department_managed'}` (and is
//     listed in `apps/api/test/unit/head-only-routes.test.ts`, which fails on an unlisted one), and
//     every per-card write re-checks ownership with the same `requireCardOwnership` the PATCH route
//     uses. The client's hiding is a convenience on top of that, never the boundary.
//  2. **A switch that is off is a 404-shaped refusal, not a silent success.** SPEC §7 puts each of
//     these behind an Imkoniyatlar switch; `requireFeature` below answers `not_found` for a
//     capability the department has not turned on, so a probe cannot enumerate what exists.
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { withContext } from '@devon/db'
import {
  DEFAULT_WEEKLY_CAPACITY_HOURS,
  cardTemplatePayloadSchema,
  minutesToHours,
  resolveFeatures,
  type FeatureKey,
  type FilterableCard,
} from '@devon/contracts'
import { isHeadOf } from '../../lib/actor.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'
import {
  departmentChildSubject,
  departmentManagedSubject,
  ownViewerSubject,
  requireCardOwnership,
  requireDepartmentId,
} from './guards.js'
import * as plus from './plus-repo.js'
import * as repo from './repo.js'
import { idParamsSchema, type CardDTO } from './schemas.js'
import {
  addFocusBodySchema,
  bulkCardPatchBodySchema,
  bulkCardResultSchema,
  bulkUndoBodySchema,
  capacityListSchema,
  cardDependenciesSchema,
  cardReminderListSchema,
  cardTimeLogSchema,
  createDependencyBodySchema,
  createFromCardTemplateBodySchema,
  createGoalBodySchema,
  createReminderBodySchema,
  createTimeLogBodySchema,
  createWorkTemplateBodySchema,
  dependencyParamsSchema,
  focusListSchema,
  goalListSchema,
  moveWorkloadBodySchema,
  patchGoalBodySchema,
  patchWorkTemplateBodySchema,
  putCapacityBodySchema,
  reminderParamsSchema,
  reorderFocusBodySchema,
  templateIdParamsSchema,
  templateListQuerySchema,
  timeLogParamsSchema,
  userIdParamsSchema,
  workTemplateListSchema,
  workloadQuerySchema,
  workloadSchema,
} from './schemas-plus.js'

type ZodApp = Parameters<FastifyPluginAsyncZod>[0]

/** Asia/Tashkent is UTC+5 all year (no daylight saving), which is why a plain fixed offset is
 * correct here and not a simplification waiting to break twice a year. */
const TASHKENT_OFFSET = '+05:00'

/**
 * SPEC §7: every capability in this file is behind an Imkoniyatlar switch, off by default.
 *
 * A switch that is off answers `not_found` rather than `forbidden`: "off" is a statement about the
 * department's scope, not about this person's authority, and a `forbidden` would tell a prober that
 * the capability exists and they merely lack the role. One indexed primary-key lookup; the switches
 * change a handful of times in a department's life, and every screen behind them already fetches
 * the department itself.
 */
async function requireFeature(
  req: FastifyRequest,
  reply: FastifyReply,
  departmentId: string,
  key: FeatureKey,
): Promise<boolean> {
  const rows = await withContext(contextFromRequest(req), async (tx) =>
    tx.raw<{ features: unknown }>(
      sql`select features from app.departments where id = ${departmentId}`,
    ),
  )
  const features = resolveFeatures(rows[0]?.features)
  if (!features[key]) {
    sendProblem(reply, 'not_found')
    return false
  }
  return true
}

/** The Monday (ISO date) of the week `isoDate` falls in, counted in Asia/Tashkent. */
function mondayOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (day - 1))
  return date.toISOString().slice(0, 10)
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function todayInTashkent(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function registerWorkPlusRoutes(app: ZodApp): Promise<void> {
  // -------------------------------------------------------------------------------------------
  // A10 -- dependencies
  // -------------------------------------------------------------------------------------------

  app.get(
    '/cards/:id/dependencies',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 200: cardDependenciesSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      if (!(await repo.cardExists(ctx, departmentId, req.params.id))) {
        return sendProblem(reply, 'not_found')
      }
      return reply
        .type('application/json')
        .send(await plus.getDependencies(ctx, departmentId, req.params.id))
    },
  )

  app.post(
    '/cards/:id/dependencies',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: createDependencyBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      if (!(await requireFeature(req, reply, departmentId, 'dependencies'))) return
      // A dependency changes what the *blocked* card is waiting for, so it is that card's owners
      // (or the head) who may add one -- the same rule that governs its due date.
      const ownership = await requireCardOwnership(req, reply, departmentId, req.params.id)
      if (!ownership.ok) return
      const result = await plus.addDependency(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.body.blockedByCardId,
        req.actor!.userId,
      )
      if (!result.ok) {
        if (result.reason === 'not_found') return sendProblem(reply, 'not_found')
        // A cycle and a duplicate are both "this specific value is wrong", which is what 422 with a
        // field code means -- the client renders the exact sentence from the code.
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'blockedByCardId', code: result.reason }],
        })
      }
      return reply.code(201).send({ id: result.id })
    },
  )

  app.delete(
    '/cards/:id/dependencies/:depId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: dependencyParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ownership = await requireCardOwnership(req, reply, departmentId, req.params.id)
      if (!ownership.ok) return
      const ok = await plus.removeDependency(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.params.depId,
        req.actor!.userId,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  /** Every edge at once -- what the Gantt draws its arrows from. One request per timeline render,
   * never one per bar. */
  app.get(
    '/work/dependencies',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        response: {
          200: z.array(
            z.object({
              id: z.string().uuid(),
              cardId: z.string().uuid(),
              blockedByCardId: z.string().uuid(),
            }),
          ),
        },
      },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send([])
      return reply.send(await plus.listDependencyEdges(contextFromRequest(req), departmentId))
    },
  )

  // -------------------------------------------------------------------------------------------
  // A3 -- the light time log
  // -------------------------------------------------------------------------------------------

  app.get(
    '/cards/:id/time-logs',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 200: cardTimeLogSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      const log = await plus.getTimeLog(contextFromRequest(req), departmentId, req.params.id)
      if (!log) return sendProblem(reply, 'not_found')
      return reply.send({
        entries: log.entries,
        loggedMin: log.loggedMin,
        estimateMin: log.estimateMin,
        remainingMin:
          log.estimateMin === null ? null : Math.max(0, log.estimateMin - log.loggedMin),
      })
    },
  )

  app.post(
    '/cards/:id/time-logs',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: createTimeLogBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      if (!(await requireFeature(req, reply, departmentId, 'estimates'))) return
      // Deliberately NOT gated on card ownership: logging the time you spent helping with a
      // colleague's card is a normal thing to do, and the row is stamped with your own user id by
      // the RLS policy itself (`card_time_logs_write`), so nobody can log hours in anyone's name.
      const id = await plus.addTimeLog(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.actor!.userId,
        req.body,
      )
      if (id === null) return sendProblem(reply, 'not_found')
      return reply.code(201).send({ id })
    },
  )

  app.delete(
    '/cards/:id/time-logs/:logId',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: timeLogParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ok = await plus.removeTimeLog(
        contextFromRequest(req),
        departmentId,
        req.params.logId,
        req.actor!.userId,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  // -------------------------------------------------------------------------------------------
  // 7.4 -- reminders ("remind me at X" -> inbox + Telegram)
  // -------------------------------------------------------------------------------------------

  app.get(
    '/cards/:id/reminders',
    {
      config: { permission: { action: 'read', subject: (r) => ownViewerSubject(r) } },
      schema: { params: idParamsSchema, response: { 200: cardReminderListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send([])
      if (!(await repo.cardExists(contextFromRequest(req), departmentId, req.params.id)))
        return sendProblem(reply, 'not_found')
      return reply
        .type('application/json')
        .send(
          await plus.listReminders(
            contextFromRequest(req),
            departmentId,
            req.params.id,
            req.actor!.userId,
          ),
        )
    },
  )

  app.post(
    '/cards/:id/reminders',
    {
      config: { permission: { action: 'update', subject: (r) => ownViewerSubject(r) } },
      schema: {
        params: idParamsSchema,
        body: createReminderBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return sendProblem(reply, 'not_found')
      if (!(await requireFeature(req, reply, departmentId, 'reminders'))) return
      const id = await plus.addReminder(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        req.actor!.userId,
        req.body,
      )
      if (id === null) return sendProblem(reply, 'not_found')
      return reply.code(201).send({ id })
    },
  )

  app.delete(
    '/cards/:id/reminders/:reminderId',
    {
      config: { permission: { action: 'delete', subject: (r) => ownViewerSubject(r) } },
      schema: { params: reminderParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return sendProblem(reply, 'not_found')
      const ok = await plus.removeReminder(
        contextFromRequest(req),
        departmentId,
        req.params.reminderId,
        req.actor!.userId,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  // -------------------------------------------------------------------------------------------
  // A8 -- the multitask toolbar
  // -------------------------------------------------------------------------------------------

  app.post(
    '/cards/bulk',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { body: bulkCardPatchBodySchema, response: { 200: bulkCardResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const isHead = isHeadOf(req.actor, departmentId)
      const me = req.actor!.userId
      const result = await plus.bulkPatchCards(
        contextFromRequest(req),
        departmentId,
        req.body.ids,
        req.body.patch,
        me,
        // The same decision `can(actor, 'update', {kind:'owned'})` makes for a single card, applied
        // per row inside the one transaction -- the bulk bar is a shortcut for the user, never a
        // shortcut around the rule.
        (ownerUserIds) => isHead || ownerUserIds.includes(me),
      )
      return reply.type('application/json').send(result)
    },
  )

  app.post(
    '/cards/bulk/undo',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { body: bulkUndoBodySchema, response: { 200: bulkCardResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const isHead = isHeadOf(req.actor, departmentId)
      const me = req.actor!.userId
      const ctx = contextFromRequest(req)
      // Undo is not a special power: it is the same bulk write with the previous values, so it goes
      // through the identical ownership check. A card that has since been reassigned away from you
      // simply refuses, and the toast says how many came back.
      const results = await Promise.all(
        req.body.entries.map((entry) =>
          plus.bulkPatchCards(
            ctx,
            departmentId,
            [entry.id],
            {
              assigneeUserId: entry.assigneeUserId,
              priority: entry.priority,
              dueAt: entry.dueAt,
              status: entry.status,
              estimateMin: entry.estimateMin,
            },
            me,
            (ownerUserIds) => isHead || ownerUserIds.includes(me),
          ),
        ),
      )
      return reply.send({
        updated: results.flatMap((r) => r.updated),
        forbidden: results.flatMap((r) => r.forbidden),
        notFound: results.flatMap((r) => r.notFound),
        undo: [],
      })
    },
  )

  // -------------------------------------------------------------------------------------------
  // 7.2 -- templates
  // -------------------------------------------------------------------------------------------

  app.get(
    '/work/templates',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { querystring: templateListQuerySchema, response: { 200: workTemplateListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send([])
      const rows = await plus.listTemplates(contextFromRequest(req), departmentId, req.query.kind)
      const isHead = isHeadOf(req.actor, departmentId)
      const me = req.actor!.userId
      return reply.type('application/json').send(
        rows.map((row) => ({
          ...row,
          canManage: row.ownerUserId === me || (row.scope === 'department' && isHead),
        })),
      )
    },
  )

  app.post(
    '/work/templates',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createWorkTemplateBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      if (!(await requireFeature(req, reply, departmentId, 'templates'))) return
      // Anyone may save a personal template; the department gallery is the head's to curate
      // (`work.template.manageDepartment`), so a member's request for `scope: 'department'` is
      // refused outright rather than quietly downgraded -- a silently different result is worse
      // than a clear refusal.
      const scope = req.body.scope ?? 'personal'
      if (scope === 'department' && !isHeadOf(req.actor, departmentId)) {
        return sendProblem(reply, 'forbidden')
      }
      const id = await plus.createTemplate(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        {
          kind: req.body.kind,
          scope,
          name: req.body.name,
          description: req.body.description,
          payload: req.body.payload,
        },
      )
      return reply.code(201).send({ id })
    },
  )

  app.patch(
    '/work/templates/:id',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: templateIdParamsSchema,
        body: patchWorkTemplateBodySchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const existing = await plus.getTemplate(ctx, departmentId, req.params.id)
      if (!existing) return sendProblem(reply, 'not_found')
      const isHead = isHeadOf(req.actor, departmentId)
      const mine = existing.ownerUserId === req.actor!.userId
      if (!mine && !(existing.scope === 'department' && isHead)) {
        return sendProblem(reply, 'forbidden')
      }
      if (req.body.scope === 'department' && !isHead) return sendProblem(reply, 'forbidden')
      const ok = await plus.patchTemplate(ctx, departmentId, req.params.id, req.body)
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.delete(
    '/work/templates/:id',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: templateIdParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const existing = await plus.getTemplate(ctx, departmentId, req.params.id)
      if (!existing) return sendProblem(reply, 'not_found')
      const isHead = isHeadOf(req.actor, departmentId)
      if (
        existing.ownerUserId !== req.actor!.userId &&
        !(existing.scope === 'department' && isHead)
      ) {
        return sendProblem(reply, 'forbidden')
      }
      const ok = await plus.archiveTemplate(ctx, departmentId, req.params.id)
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.post(
    '/work/templates/:id/create-card',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: templateIdParamsSchema,
        body: createFromCardTemplateBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const template = await plus.getTemplate(ctx, departmentId, req.params.id)
      if (!template || template.kind !== 'card') return sendProblem(reply, 'not_found')
      const payload = cardTemplatePayloadSchema.safeParse(template.payload)
      if (!payload.success) {
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'payload', code: 'template_payload_invalid' }],
        })
      }
      // Same cross-tenant guard the plain card create carries (H1.3): a template cannot smuggle an
      // assignee from another department in through its payload, because the assignee comes from
      // the request and is checked against this department's active memberships.
      const named = [req.body.assigneeUserId, req.body.giverUserId].filter(
        (id): id is string => typeof id === 'string',
      )
      if (named.length > 0) {
        const members = await repo.filterDepartmentMemberIds(ctx, departmentId, named)
        if (named.some((id) => !members.has(id))) return sendProblem(reply, 'validation_failed')
      }
      const dueAt =
        req.body.dueAt !== undefined
          ? req.body.dueAt
          : payload.data.dueInDays != null
            ? new Date(Date.now() + payload.data.dueInDays * 86_400_000).toISOString()
            : null
      const card = await repo.createCard(ctx, {
        departmentId,
        title: payload.data.title,
        description: payload.data.description ?? undefined,
        kind: req.body.projectId ? 'project_task' : 'task',
        assigneeUserId: req.body.assigneeUserId ?? null,
        giverUserId: req.body.giverUserId ?? req.actor!.userId,
        priority: payload.data.priority ?? 'none',
        startAt: null,
        dueAt,
        labels: payload.data.labels ?? [],
        links: [],
        projectId: req.body.projectId ?? null,
        projectScope: req.body.projectId ? 'objective' : 'none',
        orderKey: undefined,
        createdByUserId: req.actor!.userId,
        estimateMin: payload.data.estimateMin ?? null,
        source: 'template',
      })
      await plus.applyCardTemplateChecklist(ctx, departmentId, card.id, payload.data)
      await plus.bumpTemplateUse(ctx, departmentId, template.id)
      return reply.code(201).send({ id: card.id })
    },
  )

  // -------------------------------------------------------------------------------------------
  // A9 -- the focus list ("Diqqat markazi")
  // -------------------------------------------------------------------------------------------

  app.get(
    '/work/focus',
    {
      config: { permission: { action: 'read', subject: (r) => ownViewerSubject(r) } },
      schema: { response: { 200: focusListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send({ items: [], max: plus.FOCUS_MAX })
      const items = await plus.getFocusList(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
      )
      return reply.send({ items, max: plus.FOCUS_MAX })
    },
  )

  app.post(
    '/work/focus',
    {
      config: { permission: { action: 'update', subject: (r) => ownViewerSubject(r) } },
      schema: { body: addFocusBodySchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return sendProblem(reply, 'not_found')
      if (!(await requireFeature(req, reply, departmentId, 'focus_list'))) return
      const result = await plus.addFocusPin(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.body.cardId,
      )
      if (!result.ok) {
        if (result.reason === 'not_found') return sendProblem(reply, 'not_found')
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'cardId', code: 'focus_list_full' }],
        })
      }
      return reply.code(204).send()
    },
  )

  app.delete(
    '/work/focus/:cardId',
    {
      config: { permission: { action: 'delete', subject: (r) => ownViewerSubject(r) } },
      schema: { params: z.object({ cardId: z.string().uuid() }), response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return sendProblem(reply, 'not_found')
      const ok = await plus.removeFocusPin(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.params.cardId,
      )
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.post(
    '/work/focus/reorder',
    {
      config: { permission: { action: 'update', subject: (r) => ownViewerSubject(r) } },
      schema: { body: reorderFocusBodySchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return sendProblem(reply, 'not_found')
      await plus.reorderFocusPins(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.body.cardIds,
      )
      return reply.code(204).send()
    },
  )

  // -------------------------------------------------------------------------------------------
  // A4 -- capacity and the workload grid
  // -------------------------------------------------------------------------------------------

  app.get(
    '/work/capacity',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: capacityListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send([])
      return reply.send(await plus.listCapacity(contextFromRequest(req), departmentId))
    },
  )

  app.put(
    '/work/capacity/:userId',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: userIdParamsSchema,
        body: putCapacityBodySchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      // SPEC §7 A4: a member sets their own capacity, the head sets anybody's. Expressed as an
      // `owned` decision with the subject person as the owner set, so the rule is `can()`'s and not
      // a second `role === 'head'` written here (I-7). RLS enforces the same thing underneath.
      const me = req.actor!.userId
      if (req.params.userId !== me && !isHeadOf(req.actor, departmentId)) {
        return sendProblem(reply, 'forbidden')
      }
      await plus.putCapacity(
        contextFromRequest(req),
        departmentId,
        req.params.userId,
        req.body.weeklyHours,
        me,
      )
      return reply.code(204).send()
    },
  )

  /** SPEC §2.2: the grid itself is head-only. A member's own row comes from `/work/workload/mine`
   * below, which is the same service with the rows narrowed to the caller. */
  app.get(
    '/work/workload',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: { querystring: workloadQuerySchema, response: { 200: workloadSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      if (!(await requireFeature(req, reply, departmentId, 'workload'))) return
      return reply.send(await buildWorkload(req, departmentId, null))
    },
  )

  app.get(
    '/work/workload/mine',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentChildSubject(requireDepartmentId(r)),
        },
      },
      schema: { querystring: workloadQuerySchema, response: { 200: workloadSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) {
        return reply.send({
          weekStarts: [],
          rows: [],
          unscheduled: { noDueDate: 0, noEstimate: 0, openTotal: 0 },
        })
      }
      // "Mening yuklamam" is exactly one row -- the caller's. There is no parameter to widen it,
      // which is what keeps a member from reading a colleague's load through the back door.
      return reply.send(await buildWorkload(req, departmentId, req.actor!.userId))
    },
  )

  app.post(
    '/work/workload/move',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: { body: moveWorkloadBodySchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const card = await repo.getCard(ctx, departmentId, req.body.cardId)
      if (!card) return sendProblem(reply, 'not_found')
      // Dragging inside the grid is a reassignment plus a re-dating, so it writes through the same
      // `patchCard` the card sheet does -- one activity trail, one set of domain events, one undo.
      const weekStart = mondayOf(req.body.toWeekStart)
      const weekdayOffset = card.dueAt
        ? (() => {
            const day = new Date(card.dueAt).getUTCDay()
            return day === 0 ? 6 : day - 1
          })()
        : 4 // no due date yet: land it on the Friday of the target week
      const dueAt = `${addDays(weekStart, weekdayOffset)}T09:00:00.000${TASHKENT_OFFSET}`
      const result = await repo.patchCard(
        ctx,
        departmentId,
        req.body.cardId,
        { assigneeUserId: req.body.toUserId, dueAt: new Date(dueAt).toISOString() },
        undefined,
        req.actor!.userId,
      )
      if (!result.ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  // -------------------------------------------------------------------------------------------
  // A11 -- department goals
  // -------------------------------------------------------------------------------------------

  app.get(
    '/goals',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        querystring: z.object({ includeArchived: z.coerce.boolean().optional() }),
        response: { 200: goalListSchema },
      },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)!
      if (!(await requireFeature(req, reply, departmentId, 'goals'))) return
      const ctx = contextFromRequest(req)
      const [goals, cards, members, labels, projectNames] = await Promise.all([
        plus.listGoals(ctx, departmentId, req.query.includeArchived === true),
        repo.listCards(ctx, departmentId, {}),
        repo.getMembers(ctx, departmentId),
        repo.getLabels(ctx, departmentId),
        repo.getProjectNames(ctx, departmentId),
      ])
      // Every goal on the page is computed from the SAME already-loaded card array -- eight goals
      // are still one card query, not eight (I-14).
      const filterable = makeFilterableFactory(members, labels, projectNames)
      return reply.type('application/json').send(
        goals.map((goal) => ({
          ...goal,
          ...plus.computeGoalValue(
            goal.metric,
            goal.filter,
            goal.targetValue,
            { startsOn: goal.startsOn, dueOn: goal.dueOn },
            cards,
            filterable,
            {
              meUserId: req.actor!.userId,
              resolveUserIds: (token) => resolveMemberIds(token, members),
            },
          ),
        })),
      )
    },
  )

  app.post(
    '/goals',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: createGoalBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      if (!(await requireFeature(req, reply, departmentId, 'goals'))) return
      const id = await plus.createGoal(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.body,
      )
      return reply.code(201).send({ id })
    },
  )

  app.patch(
    '/goals/:id',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: patchGoalBodySchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const { version, ...patch } = req.body
      const result = await plus.patchGoal(
        contextFromRequest(req),
        departmentId,
        req.params.id,
        patch,
        version,
      )
      if (result === 'not_found') return sendProblem(reply, 'not_found')
      if (result === 'conflict') return sendProblem(reply, 'conflict')
      return reply.code(204).send()
    },
  )

  app.delete(
    '/goals/:id',
    {
      config: {
        permission: {
          action: 'delete',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: { params: idParamsSchema, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ok = await plus.deleteGoal(contextFromRequest(req), departmentId, req.params.id)
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )
}

// ---------------------------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------------------------

/** The filter grammar needs a card's project, label and boʻlim *names*, which live on other rows.
 * Building the three maps once and closing over them keeps a page of goals at one query per source
 * instead of one per goal per card. */
function makeFilterableFactory(
  members: readonly { userId: string; unitName: string | null }[],
  labels: readonly { id: string; name: string }[],
  projectNames: Map<string, string>,
): (card: CardDTO) => FilterableCard {
  const labelNames = new Map(labels.map((l) => [l.id, l.name]))
  const unitNames = new Map(
    members.filter((m) => m.unitName).map((m) => [m.userId, m.unitName as string]),
  )
  return (card) => ({
    id: card.id,
    title: card.title,
    description: card.description?.text ?? null,
    status: card.status,
    assigneeUserId: card.assigneeUserId,
    giverUserId: card.giverUserId,
    dueAt: card.dueAt,
    estimateMin: card.estimateMin ?? null,
    projectName: card.projectId ? (projectNames.get(card.projectId) ?? null) : null,
    labelNames: card.labels.map((id) => labelNames.get(id) ?? '').filter(Boolean),
    unitName: card.assigneeUserId ? (unitNames.get(card.assigneeUserId) ?? null) : null,
  })
}

function resolveMemberIds(
  token: string,
  members: readonly { userId: string; givenName: string; familyName: string }[],
): string[] {
  const needle = token.replace(/^@/, '').toLowerCase()
  return members
    .filter(
      (m) =>
        m.givenName.toLowerCase().includes(needle) || m.familyName.toLowerCase().includes(needle),
    )
    .map((m) => m.userId)
}

/**
 * The workload grid, for the whole department or for exactly one person.
 *
 * Three queries total regardless of size: the roster, the capacity rows and one grouped card scan.
 * Everything after that is arithmetic over arrays already in memory.
 */
async function buildWorkload(
  req: FastifyRequest,
  departmentId: string,
  onlyUserId: string | null,
): Promise<z.infer<typeof workloadSchema>> {
  const query = req.query as z.infer<typeof workloadQuerySchema>
  const weeks = query.weeks ?? 6
  const firstWeek = mondayOf(query.start ?? todayInTashkent())
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(firstWeek, i * 7))
  const fromIso = `${firstWeek}T00:00:00.000${TASHKENT_OFFSET}`
  const toIso = `${addDays(firstWeek, weeks * 7)}T00:00:00.000${TASHKENT_OFFSET}`

  const ctx = contextFromRequest(req)
  const [members, capacity, raw] = await Promise.all([
    repo.getMembers(ctx, departmentId),
    plus.listCapacity(ctx, departmentId),
    plus.getWorkloadBuckets(ctx, departmentId, fromIso, toIso),
  ])

  const capacityByUser = new Map(capacity.map((c) => [c.userId, c.weeklyHours]))
  const bucketKey = (userId: string, weekStart: string) => `${userId}:${weekStart}`
  const buckets = new Map(
    raw.buckets
      .filter((b) => b.userId !== null)
      .map((b) => [bucketKey(b.userId as string, b.weekStart), b]),
  )

  const rosterRows = onlyUserId ? members.filter((m) => m.userId === onlyUserId) : members

  return {
    weekStarts,
    rows: rosterRows.map((member) => ({
      member,
      capacityHours: capacityByUser.get(member.userId) ?? DEFAULT_WEEKLY_CAPACITY_HOURS,
      cells: weekStarts.map((weekStart) => {
        const bucket = buckets.get(bucketKey(member.userId, weekStart))
        return {
          weekStart,
          estimateHours: bucket ? minutesToHours(bucket.estimateMinutes) : 0,
          cardCount: bucket?.cardCount ?? 0,
          overdueCount: bucket?.overdueCount ?? 0,
        }
      }),
    })),
    unscheduled: {
      noDueDate: raw.noDueDate,
      noEstimate: raw.noEstimate,
      openTotal: raw.openTotal,
    },
  }
}

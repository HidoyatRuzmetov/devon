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
import { resolveFeatures, type FeatureKey } from '@devon/contracts'
import { withContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { isHeadOf } from '../../lib/actor.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'
import {
  departmentChildSubject,
  ownViewerSubject,
  requireCardOwnership,
  requireDepartmentId,
} from './guards.js'
import * as plus from './plus-repo.js'
import * as repo from './repo.js'
import {
  addFocusBodySchema,
  bulkCardPatchBodySchema,
  bulkCardResultSchema,
  bulkUndoBodySchema,
  cardDependenciesSchema,
  cardReminderListSchema,
  cardTimeLogSchema,
  createDependencyBodySchema,
  createFromCardTemplateBodySchema,
  createReminderBodySchema,
  createTimeLogBodySchema,
  createWorkTemplateBodySchema,
  dependencyParamsSchema,
  focusListSchema,
  patchWorkTemplateBodySchema,
  reminderParamsSchema,
  reorderFocusBodySchema,
  templateIdParamsSchema,
  templateListQuerySchema,
  timeLogParamsSchema,
  workTemplateListSchema,
} from './schemas-plus.js'
import { idParamsSchema } from './schemas.js'

type ZodApp = Parameters<FastifyPluginAsyncZod>[0]

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
      schema: {
        params: idParamsSchema,
        response: { 200: cardDependenciesSchema },
      },
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
      schema: {
        params: dependencyParamsSchema,
        response: { 204: z.undefined() },
      },
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
      config: {
        permission: { action: 'read', subject: (r) => ownViewerSubject(r) },
      },
      schema: {
        params: idParamsSchema,
        response: { 200: cardReminderListSchema },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownViewerSubject(r) },
      },
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
      config: {
        permission: { action: 'delete', subject: (r) => ownViewerSubject(r) },
      },
      schema: {
        params: reminderParamsSchema,
        response: { 204: z.undefined() },
      },
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
      schema: {
        body: bulkCardPatchBodySchema,
        response: { 200: bulkCardResultSchema },
      },
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
      schema: {
        body: bulkUndoBodySchema,
        response: { 200: bulkCardResultSchema },
      },
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
      const result = await withContext(ctx, async (tx) => {
        const results: plus.BulkResult[] = []
        // Every entry uses this exact transaction; a later invalid target rolls back earlier ones.
        for (const entry of req.body.entries) {
          results.push(
            // nosemgrep: query-in-loop -- Up to200 entries may repeat a card; its next ownership/version check depends on the preceding restore in this transaction, and any invalid target must stop and roll back all writes.
            await plus.bulkPatchCardsInTx(
              tx,
              departmentId,
              [entry.id],
              {
                assigneeUserId: entry.assigneeUserId,
                priority: entry.priority,
                dueAt: entry.dueAt,
                status: entry.status,
                estimateMin: entry.estimateMin,
                restoreLabelIds: entry.labels,
              },
              me,
              (ownerUserIds) => isHead || ownerUserIds.includes(me),
            ),
          )
        }
        return {
          updated: results.flatMap((r) => r.updated),
          forbidden: results.flatMap((r) => r.forbidden),
          notFound: results.flatMap((r) => r.notFound),
          undo: [],
        }
      })
      return reply.send(result)
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
      schema: {
        querystring: templateListQuerySchema,
        response: { 200: workTemplateListSchema },
      },
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
          canManage: row.scope === 'department' ? isHead : row.ownerUserId === me,
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
      if (existing.scope === 'department' ? !isHead : !mine) {
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
      schema: {
        params: templateIdParamsSchema,
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
      if (existing.scope === 'department' ? !isHead : existing.ownerUserId !== req.actor!.userId) {
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
      const result = await plus.createFromCardTemplate(ctx, departmentId, req.params.id, req.body)
      if (!result.ok) return sendProblem(reply, result.reason)
      return reply.code(201).send({ id: result.id })
    },
  )

  // -------------------------------------------------------------------------------------------
  // A9 -- the focus list ("Diqqat markazi")
  // -------------------------------------------------------------------------------------------

  app.get(
    '/work/focus',
    {
      config: {
        permission: { action: 'read', subject: (r) => ownViewerSubject(r) },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownViewerSubject(r) },
      },
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
      config: {
        permission: { action: 'delete', subject: (r) => ownViewerSubject(r) },
      },
      schema: {
        params: z.object({ cardId: z.string().uuid() }),
        response: { 204: z.undefined() },
      },
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
      config: {
        permission: { action: 'update', subject: (r) => ownViewerSubject(r) },
      },
      schema: {
        body: reorderFocusBodySchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return sendProblem(reply, 'not_found')
      const reordered = await plus.reorderFocusPins(
        contextFromRequest(req),
        departmentId,
        req.actor!.userId,
        req.body.cardIds,
      )
      if (!reordered) return sendProblem(reply, 'conflict')
      return reply.code(204).send()
    },
  )
}

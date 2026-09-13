// EPIC-017 -- automations: the head's rule builder, its run log and its kill switch.
//
// Every route is `{kind:'department_managed'}` -- head-only for reads *and* writes (SPEC §2.2 puts
// `automations.read` and `automations.manage` there). A xodim never learns that a rule exists; they
// only ever see its effect, which is a card that was assigned, labelled or moved.
//
// The engine itself lives in `engine.ts` and is wired up in this plugin's body, the same place
// `notifications/index.ts` starts its own job runner -- never from `app.ts`, which is never edited
// to add a module (MODULE-GUIDE.md "API modules").
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { PgBoss } from 'pg-boss'
import { z } from 'zod'
import {
  AUTOMATION_MAX_RULES,
  automationRuleBodySchema,
  isActionAllowedForTrigger,
} from '@devon/contracts'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from './context.js'
import { registerAutomationSubscriptions, runTimeTriggerScan } from './engine.js'
import * as repo from './repo.js'
import {
  automationRuleListSchema,
  automationRunListSchema,
  idParamsSchema,
  patchAutomationBodySchema,
  runsQuerySchema,
} from './schemas.js'

function departmentManagedSubject(departmentId: string | null) {
  return { kind: 'department_managed' as const, departmentId: departmentId ?? '' }
}

function requireDepartmentId(req: { actor: { departmentId: string | null } | null }) {
  return req.actor?.departmentId ?? null
}

const QUEUE_TIME_TRIGGERS = 'automations.time-triggers'
const TZ = 'Asia/Tashkent'

let scanWorker: { stop(): Promise<unknown> } | null = null
let unsubscribe: (() => void) | null = null

const automationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: { response: { 200: automationRuleListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send([])
      return reply.send(await repo.listRules(contextFromRequest(req), departmentId))
    },
  )

  app.post(
    '/',
    {
      config: {
        permission: {
          action: 'create',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: automationRuleBodySchema,
        response: { 201: z.object({ id: z.string().uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      // A limit stated in the copy beats a rule set nobody can reason about (the same reasoning
      // `FIELD_CAPS` follows). The client shows the cap and the count; this is the boundary.
      if ((await repo.countRules(ctx, departmentId)) >= AUTOMATION_MAX_RULES) {
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'name', code: 'too_many_rules' }],
        })
      }
      const id = await repo.createRule(ctx, departmentId, req.actor!.userId, {
        name: req.body.name,
        trigger: req.body.trigger,
        triggerConfig: req.body.triggerConfig,
        actions: req.body.actions,
        enabled: req.body.enabled,
      })
      return reply.code(201).send({ id })
    },
  )

  app.patch(
    '/:id',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        params: idParamsSchema,
        body: patchAutomationBodySchema,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const ctx = contextFromRequest(req)
      const { version, ...patch } = req.body
      if (patch.actions) {
        // The trigger cannot change once a rule exists (changing it would silently invalidate every
        // action), so the allow-list is checked against the rule's *stored* trigger rather than
        // whatever the body says.
        const existing = (await repo.listRules(ctx, departmentId)).find(
          (r) => r.id === req.params.id,
        )
        if (!existing) return sendProblem(reply, 'not_found')
        const bad = patch.actions.find((a) => !isActionAllowedForTrigger(existing.trigger, a.kind))
        if (bad) {
          return sendProblem(reply, 'validation_failed', {
            errors: [{ path: 'actions', code: 'action_not_allowed_for_trigger' }],
          })
        }
      }
      const result = await repo.patchRule(ctx, departmentId, req.params.id, patch, version)
      if (result === 'not_found') return sendProblem(reply, 'not_found')
      if (result === 'conflict') return sendProblem(reply, 'conflict')
      return reply.code(204).send()
    },
  )

  app.delete(
    '/:id',
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
      const ok = await repo.deleteRule(contextFromRequest(req), departmentId, req.params.id)
      if (!ok) return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.get(
    '/runs',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: { querystring: runsQuerySchema, response: { 200: automationRunListSchema } },
    },
    async (req, reply) => {
      const departmentId = requireDepartmentId(req)
      if (!departmentId) return reply.send({ items: [], nextCursor: null, total: 0 })
      return reply.send(
        await repo.listRuns(contextFromRequest(req), departmentId, {
          ruleId: req.query.ruleId,
          limit: req.query.limit ?? 50,
          cursor: req.query.cursor,
        }),
      )
    },
  )

  /** The kill switch. One act, not twenty-five -- and reversible by the same route, because the
   * reason a head reaches for it is usually "something is wrong, stop everything while I look". */
  app.post(
    '/pause-all',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => departmentManagedSubject(requireDepartmentId(r)),
        },
      },
      schema: {
        body: z.object({ enabled: z.boolean() }),
        response: { 200: z.object({ changed: z.number().int() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = requireDepartmentId(req)!
      const changed = await repo.setAllRulesEnabled(
        contextFromRequest(req),
        departmentId,
        req.body.enabled,
      )
      return reply.send({ changed })
    },
  )

  // The engine's two halves, started exactly once per process. Guarded by `NODE_ENV === 'test'`
  // like every other background worker in this codebase: the `unit` gate has no Postgres, and a
  // test that builds a test app must never start a timer or a subscription (MODULE-GUIDE.md).
  app.addHook('onReady', async () => {
    if (app.devonConfig.NODE_ENV === 'test') return
    if (unsubscribe === null) unsubscribe = registerAutomationSubscriptions(app.log)
    if (scanWorker !== null) return
    try {
      const boss = new PgBoss(app.devonConfig.DATABASE_URL)
      boss.on('error', (err: unknown) => app.log.error({ err }, 'automations: pg-boss error'))
      await boss.start()
      await boss.createQueue(QUEUE_TIME_TRIGGERS).catch(() => {})
      await boss.work(QUEUE_TIME_TRIGGERS, async () => {
        await runTimeTriggerScan(app.log)
      })
      await boss.schedule(QUEUE_TIME_TRIGGERS, '0 * * * *', null, { tz: TZ })
      scanWorker = { stop: () => boss.stop({ graceful: true }) }
      app.log.info('automations: hourly due-soon/overdue scan scheduled (Asia/Tashkent)')
    } catch (err) {
      app.log.error(
        { err },
        'automations: scan scheduler failed to start -- time-based rules are idle until the next boot',
      )
    }
  })

  app.addHook('onClose', async () => {
    unsubscribe?.()
    unsubscribe = null
    await scanWorker?.stop()
    scanWorker = null
  })
}

export default automationsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/automations`.
export const prefix = '/automations'

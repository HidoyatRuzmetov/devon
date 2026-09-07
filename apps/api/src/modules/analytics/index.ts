// /api/v1/analytics/* (TECH-SPEC §9; TASKS.md EPIC-010). Fastify plugin -- auto-discovered by
// `apps/api/src/module-loader.ts` (MODULE-GUIDE.md "API modules"). Every route declares
// `config.permission`; the summary/personal/export routes are `read` for any active member (TECH-SPEC
// §9: "for everyone in the department"); saved filters and pinned charts are owner-scoped in `repo.ts`
// itself (mirrors `work.saved_views`'s "shared" split), same posture `personal`'s owner-only routes
// take even though these tables are `department_child`, not `personal`.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import { registerRecomputeSubscription, startAnalyticsRecomputeWorker } from './aggregate.js'
import { summaryChartToCsv } from './csv.js'
import * as repo from './repo.js'
import {
  analyticsChartKeySchema,
  analyticsSummarySchema,
  createPinBodySchema,
  createSavedFilterBodySchema,
  patchSavedFilterBodySchema,
  pinnedChartListSchema,
  pinnedChartSchema,
  reorderPinsBodySchema,
  savedFilterListSchema,
  savedFilterSchema,
  summaryQuerySchema,
} from './schemas.js'
import type { PersonalOverview, PinnedChartRow, SavedFilterRow, SummaryResult } from './repo.js'

const idParamsSchema = z.object({ id: z.string().uuid() })
const exportQuerySchema = summaryQuerySchema.extend({ chart: analyticsChartKeySchema })

function activeDepartmentId(req: FastifyRequest): string {
  return req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? ''
}

function ctxFrom(req: FastifyRequest): AuditCtx {
  return {
    requestId: req.id,
    userId: req.actor!.userId,
    actorRole: req.actor!.role,
    actingForUserId: null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

function savedFilterToDto(row: SavedFilterRow) {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    sinceDays: row.since_days,
    shared: row.shared,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

function pinnedChartToDto(row: PinnedChartRow) {
  return {
    id: row.id,
    chartKey: row.chart_key,
    title: row.title,
    filterQuery: row.filter_query,
    sort: row.sort,
    createdAt: row.created_at.toISOString(),
  }
}

function personalToDto(overview: PersonalOverview) {
  return overview
}

function summaryToDto(summary: SummaryResult) {
  return {
    ...summary,
    eventsParticipation: summary.eventsParticipation.map((e) => ({
      ...e,
      startsAt: e.startsAt.toISOString(),
    })),
  }
}

let recomputeSubscribed = false
let recomputeWorker: Awaited<ReturnType<typeof startAnalyticsRecomputeWorker>> = null

const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  if (!recomputeSubscribed) {
    registerRecomputeSubscription(app.log)
    recomputeSubscribed = true
  }

  app.addHook('onReady', async () => {
    if (app.devonConfig.NODE_ENV === 'test') return
    recomputeWorker = await startAnalyticsRecomputeWorker(app.devonConfig.DATABASE_URL, app.log)
  })
  app.addHook('onClose', async () => {
    if (recomputeWorker) await recomputeWorker.stop().catch(() => {})
  })

  const departmentChildSubject = (r: FastifyRequest) => ({
    kind: 'department_child' as const,
    departmentId: activeDepartmentId(r),
  })

  // -- Summary + personal overview ------------------------------------------------------------------

  app.get(
    '/summary',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { querystring: summaryQuerySchema, response: { 200: analyticsSummarySchema } },
    },
    async (req) => {
      const summary = await repo.getSummary(
        activeDepartmentId(req),
        req.actor!.userId,
        ctxFrom(req),
        req.query,
      )
      return summaryToDto(summary)
    },
  )

  app.get(
    '/personal',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { response: { 200: analyticsSummarySchema.shape.personal } },
    },
    async (req) => {
      const overview = await repo.getPersonalOverview(
        activeDepartmentId(req),
        req.actor!.userId,
        ctxFrom(req),
      )
      return personalToDto(overview)
    },
  )

  app.get(
    '/export.csv',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { querystring: exportQuerySchema },
    },
    async (req, reply) => {
      const summary = await repo.getSummary(
        activeDepartmentId(req),
        req.actor!.userId,
        ctxFrom(req),
        req.query,
      )
      const csv = summaryChartToCsv(req.query.chart, summary)
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('cache-control', 'private, no-store')
        .header('content-disposition', `attachment; filename="${req.query.chart}.csv"`)
        .send(csv)
    },
  )

  // -- Saved filters ---------------------------------------------------------------------------------

  app.get(
    '/saved-filters',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { response: { 200: savedFilterListSchema } },
    },
    async (req) => {
      const rows = await repo.listSavedFilters(
        activeDepartmentId(req),
        req.actor!.userId,
        ctxFrom(req),
      )
      return rows.map(savedFilterToDto)
    },
  )

  app.post(
    '/saved-filters',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { body: createSavedFilterBodySchema, response: { 201: savedFilterSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.createSavedFilter(
        activeDepartmentId(req),
        req.actor!.userId,
        req.body,
        ctxFrom(req),
      )
      reply.code(201).send(savedFilterToDto(row))
    },
  )

  app.patch(
    '/saved-filters/:id',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
      schema: {
        params: idParamsSchema,
        body: patchSavedFilterBodySchema,
        response: { 200: savedFilterSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const outcome = await repo.patchSavedFilter(
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
        req.body,
        ctxFrom(req),
      )
      if (outcome.ok === 'not_found') return sendProblem(reply, 'not_found')
      if (outcome.ok === 'conflict') return sendProblem(reply, 'conflict')
      reply.send(savedFilterToDto(outcome.row))
    },
  )

  app.delete(
    '/saved-filters/:id',
    {
      config: { permission: { action: 'delete', subject: departmentChildSubject } },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.deleteSavedFilter(
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
        ctxFrom(req),
      )
      if (!ok) return sendProblem(reply, 'not_found')
      reply.code(204).send()
    },
  )

  // -- Pinned charts (pin to Home) --------------------------------------------------------------------

  app.get(
    '/pins',
    {
      config: { permission: { action: 'read', subject: departmentChildSubject } },
      schema: { response: { 200: pinnedChartListSchema } },
    },
    async (req) => {
      const rows = await repo.listPinnedCharts(
        activeDepartmentId(req),
        req.actor!.userId,
        ctxFrom(req),
      )
      return rows.map(pinnedChartToDto)
    },
  )

  app.post(
    '/pins',
    {
      config: { permission: { action: 'create', subject: departmentChildSubject } },
      schema: { body: createPinBodySchema, response: { 201: pinnedChartSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const row = await repo.pinChart(
        activeDepartmentId(req),
        req.actor!.userId,
        req.body,
        ctxFrom(req),
      )
      reply.code(201).send(pinnedChartToDto(row))
    },
  )

  app.delete(
    '/pins/:id',
    {
      config: { permission: { action: 'delete', subject: departmentChildSubject } },
      schema: { params: idParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.unpinChart(
        activeDepartmentId(req),
        req.actor!.userId,
        req.params.id,
        ctxFrom(req),
      )
      if (!ok) return sendProblem(reply, 'not_found')
      reply.code(204).send()
    },
  )

  app.post(
    '/pins/reorder',
    {
      config: { permission: { action: 'update', subject: departmentChildSubject } },
      schema: {
        body: reorderPinsBodySchema,
        response: { 200: z.object({ updated: z.number().int() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const updated = await repo.reorderPinnedCharts(
        activeDepartmentId(req),
        req.actor!.userId,
        req.body.ids,
        ctxFrom(req),
      )
      reply.send({ updated })
    },
  )
}

export default analyticsRoutes

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/analytics`.
export const prefix = '/analytics'

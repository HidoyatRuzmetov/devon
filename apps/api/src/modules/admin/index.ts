// /api/v1/admin/* -- super_admin only (design.md §3.4, AC-11; TECH-SPEC §10/§11, EPIC-013). See
// `denyForSubject`'s doc comment for why `setNotFoundHandler` calls the exact same function every
// matched route's `preHandler` uses -- a byte-identical 403 for matched vs. unmatched admin paths.
import { Readable } from 'node:stream'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { denyForSubject } from '../../plugins/authorize.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { checkCsrf } from '../../lib/csrf.js'
import { sessionCookieOptions, expiredSessionCookieOptions } from '../../lib/cookies.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { adminInstanceSchema, chainVerificationSchema } from '../../schemas.js'
import * as repo from './repo.js'
import {
  signViewAsCookie,
  verifyViewAsCookie,
  VIEW_AS_COOKIE_NAME,
  VIEW_AS_MAX_MINUTES,
} from './view-as.js'
import {
  adminAnalyticsSchema,
  adminDepartmentDetailSchema,
  adminDepartmentListQuerySchema,
  adminDepartmentListSchema,
  adminHealthSchema,
  adminUserDetailSchema,
  adminUserListQuerySchema,
  adminUserListSchema,
  auditEventListSchema,
  auditEventQuerySchema,
  departmentIdParamsSchema,
  lockUserBodySchema,
  maintenanceStateSchema,
  patchMaintenanceBodySchema,
  patchRegistrationBodySchema,
  pauseDepartmentBodySchema,
  sentinelKeyResultSchema,
  sentinelStatusSchema,
  startWipeBodySchema,
  userIdParamsSchema,
  wipeStartResultSchema,
  wipeStatusSchema,
} from './schemas.js'

// H2.8 (streaming CSV export): pages through every audit event matching the export's filters (the
// same filter fields `GET /audit/events` takes -- `cursor`/`limit` on the querystring are that list
// endpoint's own pagination and are deliberately not read here, since an export means "everything
// matching", not "the page I'm looking at") and yields CSV lines lazily, one page at a time, so
// `Readable.from()` in the route below can start streaming the response before the whole export has
// even been read from Postgres, and peak memory never holds more than one page of rows regardless of
// how many years of audit history match. `AUDIT_EXPORT_MAX_ROWS` is a sanity cap, not a silent
// truncation: past it the generator stops (the client still gets a complete, valid CSV of everything
// up to the cap) rather than the process holding an unbounded row count in flight forever.
const AUDIT_EXPORT_PAGE_SIZE = 1000
const AUDIT_EXPORT_MAX_ROWS = 200_000

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

async function* auditExportRows(query: {
  action?: string | undefined
  category?: string | undefined
  actorUserId?: string | undefined
  departmentId?: string | undefined
  from?: string | undefined
  to?: string | undefined
}): AsyncGenerator<string> {
  yield 'seq,at,actor_user_id,actor_name,actor_role,department_id,action,subject_type,subject_id\n'
  const filters = {
    action: query.action,
    category: query.category,
    actorUserId: query.actorUserId,
    departmentId: query.departmentId,
    from: query.from,
    to: query.to,
  }
  let cursor: number | undefined
  let emitted = 0
  for (;;) {
    const { rows, nextCursor } = await repo.listAuditEvents({
      ...filters,
      cursor,
      limit: AUDIT_EXPORT_PAGE_SIZE,
    })
    if (rows.length === 0) return
    for (const e of rows) {
      yield [
        e.seq,
        e.at.toISOString(),
        e.actorUserId ?? '',
        e.actorName ?? '',
        e.actorRole ?? '',
        e.departmentId ?? '',
        e.action,
        e.subjectType,
        e.subjectId ?? '',
      ]
        .map((v) => csvEscape(String(v)))
        .join(',') + '\n'
      emitted += 1
      if (emitted >= AUDIT_EXPORT_MAX_ROWS) return
    }
    if (nextCursor === null) return
    cursor = nextCursor
  }
}

const adminPlugin: FastifyPluginAsyncZod = async (app) => {
  const instanceSubject = () => ({ kind: 'instance' as const })
  // Blitz finding: distinct from `instanceSubject` on purpose -- see `@devon/contracts`'s
  // `instance_exit_view_as` case for why the exit route cannot reuse `{kind:'instance'}`.
  const instanceExitViewAsSubject = () => ({ kind: 'instance_exit_view_as' as const })

  function auditCtx(req: FastifyRequest) {
    return {
      requestId: req.id,
      userId: req.actor?.userId ?? null,
      actorRole: req.actor?.role ?? null,
      actingForUserId: null,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    }
  }

  // -- Instance / audit (unchanged from the previous checkpoint) -------------------------------

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

  // -- Departments --------------------------------------------------------------------------------

  app.get(
    '/departments',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: {
        querystring: adminDepartmentListQuerySchema,
        response: { 200: adminDepartmentListSchema },
      },
    },
    async (req) => {
      const { rows, nextCursor } = await repo.listDepartments(req.query)
      return {
        departments: rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
        nextCursor,
      }
    },
  )

  app.get(
    '/departments/:id',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: departmentIdParamsSchema, response: { 200: adminDepartmentDetailSchema } },
    },
    async (req, reply) => {
      const detail = await repo.getDepartmentDetail(req.params.id)
      if (!detail) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.send({ ...detail, createdAt: detail.createdAt.toISOString() })
    },
  )

  app.post(
    '/departments/:id/pause',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: departmentIdParamsSchema, body: pauseDepartmentBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.pauseDepartment(req.params.id, req.body.reason, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/departments/:id/resume',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.resumeDepartment(req.params.id, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/departments/:id/archive',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.archiveDepartment(req.params.id, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/departments/:id/restore',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.restoreDepartment(req.params.id, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  // View-as (I-8a): a signed, httpOnly cookie carries `(departmentId, expiresAt)`; `plugins/
  // session.ts`'s minimal hook verifies it every request and sets `req.actor.viewAs` for every other
  // module's routes to see, unchanged. Read-only by construction (RLS's `... and not is_view_as()` on
  // every department-scoped write policy) -- this route only ever needs to prove the target department
  // still exists and audit that the lens was opened.
  app.post(
    '/departments/:id/view-as',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: departmentIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const detail = await repo.getDepartmentDetail(req.params.id)
      if (!detail) {
        sendProblem(reply, 'not_found')
        return
      }
      const { value } = signViewAsCookie(req.params.id, app.devonConfig.CSRF_SECRET)
      reply.setCookie(VIEW_AS_COOKIE_NAME, value, sessionCookieOptions(VIEW_AS_MAX_MINUTES * 60))
      await repo.recordViewAsStarted(req.params.id, auditCtx(req))
      reply.code(204).send()
    },
  )

  app.post(
    '/view-as/stop',
    {
      config: { permission: { action: 'administer', subject: instanceExitViewAsSubject } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentId = verifyViewAsCookie(
        req.cookies[VIEW_AS_COOKIE_NAME],
        app.devonConfig.CSRF_SECRET,
      )
      reply.setCookie(VIEW_AS_COOKIE_NAME, '', expiredSessionCookieOptions())
      if (departmentId) await repo.recordViewAsStopped(departmentId, auditCtx(req))
      reply.code(204).send()
    },
  )

  // -- Accounts -------------------------------------------------------------------------------------

  app.get(
    '/accounts',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { querystring: adminUserListQuerySchema, response: { 200: adminUserListSchema } },
    },
    async (req) => {
      const { rows, nextCursor } = await repo.searchUsers(req.query)
      return {
        users: rows.map((u) => ({
          ...u,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
        nextCursor,
      }
    },
  )

  app.get(
    '/accounts/:id',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: userIdParamsSchema, response: { 200: adminUserDetailSchema } },
    },
    async (req, reply) => {
      const detail = await repo.getUserDetail(req.params.id)
      if (!detail) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.send({
        ...detail,
        lastLoginAt: detail.lastLoginAt?.toISOString() ?? null,
        createdAt: detail.createdAt.toISOString(),
        lockedUntil: detail.lockedUntil?.toISOString() ?? null,
      })
    },
  )

  app.post(
    '/accounts/:id/lock',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: userIdParamsSchema, body: lockUserBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.lockUser(req.params.id, req.body.reason, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/accounts/:id/unlock',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: userIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.unlockUser(req.params.id, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/accounts/:id/force-2fa-reset',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: userIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.forceTwoFactorReset(req.params.id, auditCtx(req))
      reply.code(204).send()
    },
  )

  app.post(
    '/accounts/:id/anonymize',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { params: userIdParamsSchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.anonymizeUser(req.params.id, auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  // -- Analytics --------------------------------------------------------------------------------

  app.get(
    '/analytics',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: adminAnalyticsSchema } },
    },
    async () => {
      const a = await repo.getGlobalAnalytics()
      return { ...a, generatedAt: a.generatedAt.toISOString() }
    },
  )

  // -- Audit ------------------------------------------------------------------------------------

  app.get(
    '/audit/events',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { querystring: auditEventQuerySchema, response: { 200: auditEventListSchema } },
    },
    async (req) => {
      const { rows, nextCursor } = await repo.listAuditEvents(req.query)
      return { events: rows.map((e) => ({ ...e, at: e.at.toISOString() })), nextCursor }
    },
  )

  app.get(
    '/audit/export',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { querystring: auditEventQuerySchema },
    },
    async (req, reply) => {
      await repo.recordAuditExport(auditCtx(req))
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="audit-export.csv"')
        // H2.8 "streaming for exports": the audit log can hold years of history, so this used to
        // fetch a hardcoded `limit: 1000` (silently truncating any export past that, with no signal
        // to the caller that it happened) and join every row into one in-memory string before
        // sending. `auditExportRows` below pages through the whole matching range with the same
        // cursor `repo.listAuditEvents` already exposes to `GET /audit/events`, yielding CSV lines as
        // it goes -- memory use stays flat (one page at a time) however many rows match, and nothing
        // is silently dropped short of `AUDIT_EXPORT_MAX_ROWS`.
        .send(Readable.from(auditExportRows(req.query)))
    },
  )

  // -- Health -----------------------------------------------------------------------------------

  app.get(
    '/health',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: adminHealthSchema } },
    },
    async () => {
      const h = await repo.getSystemHealth()
      return { ...h, checkedAt: h.checkedAt.toISOString() }
    },
  )

  // -- Maintenance + registration -----------------------------------------------------------------

  app.get(
    '/maintenance',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: maintenanceStateSchema } },
    },
    async () => {
      const settings = await app.devon.getInstanceSettings()
      return settings.maintenance
    },
  )

  app.patch(
    '/maintenance',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { body: patchMaintenanceBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.setMaintenance(req.body.enabled, req.body.message, auditCtx(req))
      reply.code(204).send()
    },
  )

  app.patch(
    '/registration',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { body: patchRegistrationBodySchema },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      await repo.setRegistrationOpen(req.body.open, auditCtx(req))
      reply.code(204).send()
    },
  )

  // -- Sentinel key + wipe switch (TECH-SPEC §11) -------------------------------------------------

  app.get(
    '/sentinel/status',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: sentinelStatusSchema } },
    },
    async () => {
      const status = await repo.getSentinelStatus()
      return {
        hasActiveKey: status.hasActiveKey,
        publicKeyB64: status.publicKeyB64,
        createdAt: status.createdAt?.toISOString() ?? null,
      }
    },
  )

  app.post(
    '/sentinel/rotate-key',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: sentinelKeyResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const publicKeyB64 = await repo.rotateSentinelKey(app.devonConfig.CSRF_SECRET, auditCtx(req))
      reply.send({ publicKeyB64 })
    },
  )

  app.get(
    '/wipe/status',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { response: { 200: wipeStatusSchema } },
    },
    async () => {
      const pending = await repo.getActiveWipeRequest()
      if (!pending) return null
      return {
        id: pending.id,
        status: pending.status,
        countdownEndsAt: pending.countdownEndsAt.toISOString(),
        phrase: pending.phrase,
        failureReason: pending.failureReason,
      }
    },
  )

  app.post(
    '/wipe/start',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
      schema: { body: startWipeBodySchema, response: { 200: wipeStartResultSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const [settings, userCount] = await Promise.all([
        app.devon.getInstanceSettings(),
        app.devon.countUsers(),
      ])
      const expectedPhrase = `WIPE ${userCount} ${settings.isDemo ? 'DEMO' : 'PROD'}`
      const result = await repo.startWipe(
        { ...req.body, expectedPhrase },
        app.devonConfig.CSRF_SECRET,
        auditCtx(req),
      )
      if (!result.ok) {
        sendProblem(
          reply,
          result.reason === 'bad_password' || result.reason === 'bad_totp'
            ? 'forbidden'
            : 'conflict',
        )
        return
      }
      reply.send({
        id: result.id,
        countdownEndsAt: result.countdownEndsAt.toISOString(),
        countdownSeconds: result.countdownSeconds,
      })
    },
  )

  app.post(
    '/wipe/cancel',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const ok = await repo.cancelWipe(auditCtx(req))
      if (!ok) {
        sendProblem(reply, 'not_found')
        return
      }
      reply.code(204).send()
    },
  )

  app.post(
    '/wipe/execute',
    {
      config: { permission: { action: 'administer', subject: instanceSubject } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const result = await repo.executeWipe(app.devonConfig.CSRF_SECRET, auditCtx(req))
      if (!result.ok) {
        sendProblem(reply, 'conflict')
        return
      }
      reply.code(204).send()
    },
  )

  app.setNotFoundHandler(async (req, reply) => {
    const allowed = await denyForSubject(req, reply, 'administer', { kind: 'instance' })
    if (!allowed) return
    sendProblem(reply, 'not_found')
  })
}

export default adminPlugin

// Auto-discovery (MODULE-GUIDE.md "API modules"): mounted at `/api/v1/admin`.
export const prefix = '/admin'

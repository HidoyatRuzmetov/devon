// Notifications module (TECH-SPEC §3.6, §6, §7): inbox CRUD, preferences, quiet hours, department
// settings, ICS feed, the domain-event intake, and the pg-boss job runner. Mounted at
// `/api/v1/notifications` (MODULE-GUIDE.md "API modules") except the ICS route, which needs its own
// unauthenticated path for calendar apps.
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import type { AuditCtx } from '../../types.js'
import {
  archiveNotifications,
  getDepartmentSettings,
  getPersonalQuietHours,
  getPrefs,
  listNotifications,
  listUpcomingForIcs,
  markAllRead,
  markRead,
  putDepartmentSettings,
  putPersonalQuietHours,
  putPrefs,
  snoozeNotification,
} from './repo.js'
import { registerNotificationEventSubscriptions } from './events.js'
import { startJobRunner, type JobRunnerHandle } from './jobs.js'
import { buildIcsCalendar, signIcsToken, verifyIcsToken } from './ics.js'
import {
  resolveEffectiveQuietWindow,
  DEPARTMENT_QUIET_DEFAULT,
  isQuieterOrEqual,
} from './quiet-hours.js'
import {
  departmentSettingsSchema,
  icsTokenParamsSchema,
  listQuerySchema,
  localeSchema,
  markManySchema,
  notificationListSchema,
  prefsSchema,
  putDepartmentSettingsSchema,
  putPrefsSchema,
  putQuietHoursSchema,
  quietHoursSchema,
  snoozeBodySchema,
} from './schemas.js'

function auditCtxFromReq(req: FastifyRequest): AuditCtx {
  return {
    requestId: req.id,
    userId: req.actor?.userId ?? null,
    actorRole: req.actor?.role ?? null,
    actingForUserId: null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}

let eventSubscriptionsRegistered = false
let jobRunner: JobRunnerHandle | null = null

const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  if (!eventSubscriptionsRegistered) {
    registerNotificationEventSubscriptions(app.log)
    eventSubscriptionsRegistered = true
  }

  app.addHook('onReady', async () => {
    if (app.devonConfig.NODE_ENV === 'test') return
    jobRunner = await startJobRunner(app.devonConfig.DATABASE_URL, app.log)
  })
  app.addHook('onClose', async () => {
    if (jobRunner) await jobRunner.stop().catch(() => {})
  })

  // --- Inbox -------------------------------------------------------------------------------------

  app.get(
    '/notifications',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { querystring: listQuerySchema, response: { 200: notificationListSchema } },
    },
    async (req, reply) => {
      const result = await listNotifications(req.actor!.userId, req.query)
      reply.send({
        items: result.items.map((n) => ({
          id: n.id,
          type: n.type,
          reason: n.reason,
          subjectType: n.subjectType,
          subjectId: n.subjectId,
          departmentId: n.departmentId,
          title: n.title,
          body: n.body,
          deepLink: n.deepLink,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
          snoozedUntil: n.snoozedUntil ? n.snoozedUntil.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount: result.unreadCount,
        nextCursor: result.nextCursor,
      })
    },
  )

  app.post(
    '/notifications/read',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { body: markManySchema, response: { 200: z.object({ updated: z.number().int() }) } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const updated = await markRead(auditCtxFromReq(req), req.actor!.userId, req.body.ids)
      reply.send({ updated })
    },
  )

  app.post(
    '/notifications/read-all',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: z.object({ updated: z.number().int() }) } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const updated = await markAllRead(auditCtxFromReq(req), req.actor!.userId)
      reply.send({ updated })
    },
  )

  app.post(
    '/notifications/archive',
    {
      config: {
        permission: {
          action: 'archive',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { body: markManySchema, response: { 200: z.object({ updated: z.number().int() }) } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const updated = await archiveNotifications(
        auditCtxFromReq(req),
        req.actor!.userId,
        req.body.ids,
      )
      reply.send({ updated })
    },
  )

  app.post(
    '/notifications/:id/snooze',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: snoozeBodySchema,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const until = new Date(Date.now() + req.body.minutes * 60_000)
      await snoozeNotification(auditCtxFromReq(req), req.actor!.userId, req.params.id, until)
      reply.code(204).send()
    },
  )

  // --- Preferences ---------------------------------------------------------------------------------

  app.get(
    '/notifications/prefs',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: prefsSchema } },
    },
    async (req, reply) => {
      reply.send({ items: await getPrefs(req.actor!.userId) })
    },
  )

  app.put(
    '/notifications/prefs',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { body: putPrefsSchema, response: { 200: prefsSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const items = await putPrefs(auditCtxFromReq(req), req.actor!.userId, req.body.items)
      reply.send({ items })
    },
  )

  // --- Quiet hours -----------------------------------------------------------------------------------

  app.get(
    '/notifications/quiet-hours',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        querystring: z.object({ departmentId: z.string().uuid().optional() }),
        response: { 200: quietHoursSchema },
      },
    },
    async (req, reply) => {
      const personal = await getPersonalQuietHours(req.actor!.userId)
      const departmentDefault = req.query.departmentId
        ? await getDepartmentSettings(req.query.departmentId).then((s) => ({
            startMinute: s.quietStartMinute,
            endMinute: s.quietEndMinute,
            includeWeekends: s.quietWeekends,
          }))
        : DEPARTMENT_QUIET_DEFAULT
      const effective = resolveEffectiveQuietWindow(personal, departmentDefault)
      reply.send({
        startMinute: personal?.startMinute ?? null,
        endMinute: personal?.endMinute ?? null,
        includeWeekends: personal?.includeWeekends ?? null,
        effective,
      })
    },
  )

  app.put(
    '/notifications/quiet-hours',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: {
        querystring: z.object({ departmentId: z.string().uuid().optional() }),
        body: putQuietHoursSchema,
        response: {
          200: quietHoursSchema,
          422: z.object({ code: z.literal('quiet_hours_too_loud') }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const departmentDefault = req.query.departmentId
        ? await getDepartmentSettings(req.query.departmentId).then((s) => ({
            startMinute: s.quietStartMinute,
            endMinute: s.quietEndMinute,
            includeWeekends: s.quietWeekends,
          }))
        : DEPARTMENT_QUIET_DEFAULT

      // "Personal override to quieter" (TECH-SPEC §7): a fully-null body clears the override (falls
      // back to the department default, which is always at least as quiet as itself); anything else
      // must not suppress fewer minutes/day than the department default.
      const isFullyNull =
        req.body.startMinute === null &&
        req.body.endMinute === null &&
        req.body.includeWeekends === null
      if (!isFullyNull) {
        const candidate = {
          startMinute: req.body.startMinute ?? departmentDefault.startMinute,
          endMinute: req.body.endMinute ?? departmentDefault.endMinute,
          includeWeekends: req.body.includeWeekends ?? departmentDefault.includeWeekends,
        }
        if (!isQuieterOrEqual(candidate, departmentDefault)) {
          reply.code(422).send({ code: 'quiet_hours_too_loud' })
          return
        }
      }
      await putPersonalQuietHours(auditCtxFromReq(req), req.actor!.userId, req.body)
      const personal = await getPersonalQuietHours(req.actor!.userId)
      const effective = resolveEffectiveQuietWindow(personal, departmentDefault)
      reply.send({
        startMinute: personal?.startMinute ?? null,
        endMinute: personal?.endMinute ?? null,
        includeWeekends: personal?.includeWeekends ?? null,
        effective,
      })
    },
  )

  // --- Department settings (department_child to read, department/head to write) ----------------------

  app.get(
    '/notifications/departments/:departmentId/settings',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({
            kind: 'department_child',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid() }),
        response: { 200: departmentSettingsSchema },
      },
    },
    async (req, reply) => {
      reply.send(await getDepartmentSettings(req.params.departmentId))
    },
  )

  app.put(
    '/notifications/departments/:departmentId/settings',
    {
      config: {
        permission: {
          action: 'update',
          subject: (r) => ({
            kind: 'department',
            departmentId: (r.params as { departmentId: string }).departmentId,
          }),
        },
      },
      schema: {
        params: z.object({ departmentId: z.string().uuid() }),
        body: putDepartmentSettingsSchema,
        response: { 200: departmentSettingsSchema },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const updated = await putDepartmentSettings(
        auditCtxFromReq(req),
        req.params.departmentId,
        req.body,
      )
      reply.send(updated)
    },
  )

  // --- ICS feed (public: calendar apps carry no session cookie) ---------------------------------------

  app.get(
    '/notifications/ics/:userId/:token',
    {
      config: { permission: { public: true } },
      schema: {
        params: z.object({ userId: z.string().uuid() }).merge(icsTokenParamsSchema),
        querystring: z.object({ locale: localeSchema.optional() }),
      },
    },
    async (req, reply) => {
      const { userId, token } = req.params
      if (!verifyIcsToken(userId, token, app.devonConfig.CSRF_SECRET)) {
        reply.code(404).send()
        return
      }
      const items = await listUpcomingForIcs(userId)
      const calendar = buildIcsCalendar(
        items,
        req.query.locale ?? 'uz-Latn',
        app.devonConfig.DEVON_PUBLIC_URL,
      )
      reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('cache-control', 'private, max-age=300')
        .send(calendar)
    },
  )

  app.get(
    '/notifications/ics-token',
    {
      config: {
        permission: {
          action: 'read',
          subject: (r) => ({ kind: 'personal', ownerUserId: r.actor?.userId ?? '' }),
        },
      },
      schema: { response: { 200: z.object({ url: z.string() }) } },
    },
    async (req, reply) => {
      const token = signIcsToken(req.actor!.userId, app.devonConfig.CSRF_SECRET)
      reply.send({ url: `/api/v1/notifications/ics/${req.actor!.userId}/${token}` })
    },
  )
}

export default notificationsRoutes
export const prefix = ''

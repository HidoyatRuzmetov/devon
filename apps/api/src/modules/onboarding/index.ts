import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { subscribe, type OutboxEventRecord } from '@devon/db'
import { onboardingSessionSchema, onboardingDocumentSchema } from '@devon/contracts'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { contextFromRequest } from '../work/context.js'
import * as repo from './repo.js'

const idParams = z.object({ id: z.uuid() })
const child = (r: FastifyRequest) => ({
  kind: 'department_child' as const,
  departmentId: r.actor?.departmentId ?? '',
})
const managed = (r: FastifyRequest) => ({
  kind: 'department_managed' as const,
  departmentId: r.actor?.departmentId ?? '',
})
const personal = (r: FastifyRequest) => ({
  kind: 'own_account' as const,
  userId: r.actor?.userId ?? '',
})

const routes: FastifyPluginAsyncZod = async (app) => {
  const handleJoin = async (event: OutboxEventRecord) => {
    const payload = event.payload as Record<string, unknown>
    const userId = payload['headUserId'] ?? payload['userId']
    const active =
      event.type === 'departments.department.created' ||
      payload['status'] === 'active' ||
      payload['decision'] === 'approved'
    if (!active || !z.uuid().safeParse(userId).success || !event.departmentId) return
    await repo.session({
      requestId: randomUUID(),
      userId: userId as string,
      actorRole: 'member',
      departmentId: event.departmentId,
      departmentRole: 'member',
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'devon/onboarding',
    })
  }
  const subscriptions = [
    'departments.member.joined',
    'departments.join_request.decided',
    'departments.department.created',
  ].map((type) => subscribe(type, handleJoin))
  app.addHook('onClose', async () => {
    subscriptions.forEach((unsubscribe) => unsubscribe())
  })

  app.post(
    '/session',
    {
      config: { permission: { action: 'update', subject: personal } },
      schema: {
        body: z
          .object({
            htmlDone: z.literal(true).optional(),
            completeSetup: z.literal(true).optional(),
            tourStep: z.number().int().min(0).max(50).optional(),
            tourCompleted: z.literal(true).optional(),
            paused: z.boolean().optional(),
          })
          .strict(),
        response: { 200: onboardingSessionSchema },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      if (!checkCsrf(req, reply)) return
      if (!req.actor?.departmentId || req.actor.viewAs) return sendProblem(reply, 'forbidden')
      return repo.session(contextFromRequest(req), req.body)
    },
  )

  app.get(
    '/documents',
    {
      config: { permission: { action: 'read', subject: child } },
      schema: {
        querystring: z.object({
          view: z.enum(['published', 'mine', 'review']).default('published'),
        }),
        response: {
          200: z.object({
            revision: z.number().int(),
            items: z.array(onboardingDocumentSchema),
          }),
        },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      const view = req.query.view
      const context = contextFromRequest(req)
      if (
        (view !== 'published' && context.viewAs) ||
        (view === 'review' && context.departmentRole !== 'head')
      )
        return sendProblem(reply, 'forbidden')
      return repo.documents(context, view)
    },
  )

  app.post(
    '/documents',
    {
      bodyLimit: 12_600_000,
      config: {
        permission: { action: 'create', subject: child },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        body: z
          .object({
            title: z.string().trim().min(1).max(120),
            filename: z
              .string()
              .min(1)
              .max(200)
              .regex(/^[^/\\]+\.html?$/i),
            html: z
              .string()
              .min(1)
              .max(2_097_152)
              .refine((s) => Buffer.byteLength(s, 'utf8') <= 2_097_152)
              .refine((s) =>
                /<(?:!doctype\s+html|html|head|body|main|div|section|article)\b/i.test(s),
              ),
          })
          .strict(),
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return reply.code(201).send(await repo.upload(contextFromRequest(req), req.body))
    },
  )

  // Metadata is JSON; the separate render response enforces isolation even when opened directly.
  app.get(
    '/documents/:id',
    {
      config: { permission: { action: 'read', subject: child } },
      schema: {
        params: idParams,
        response: { 200: z.object({ title: z.string(), html: z.string() }) },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      return (
        (await repo.document(contextFromRequest(req), req.params.id)) ??
        sendProblem(reply, 'not_found')
      )
    },
  )

  app.get(
    '/documents/:id/render',
    {
      config: { permission: { action: 'read', subject: child } },
      schema: { params: idParams },
    },
    async (req, reply) => {
      const document = await repo.document(contextFromRequest(req), req.params.id)
      if (!document) return sendProblem(reply, 'not_found')
      // The response itself is sandboxed, even if opened outside our iframe. No same-origin
      // capability, forms, popups, parent navigation, network APIs or child frames are granted.
      reply.header('cache-control', 'private, no-store')
      reply.header('x-frame-options', 'SAMEORIGIN')
      reply.header(
        'content-security-policy',
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      )
      return reply.type('text/html; charset=utf-8').send(document.html)
    },
  )

  app.post(
    '/documents/:id/decision',
    {
      config: { permission: { action: 'update', subject: managed } },
      schema: {
        params: idParams,
        body: z
          .object({
            action: z.enum(['publish', 'reject']),
            revision: z.number().int().nonnegative(),
          })
          .strict(),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      return (await repo.decide(contextFromRequest(req), req.params.id, req.body))
        ? { ok: true as const }
        : sendProblem(reply, 'conflict')
    },
  )
}

export default routes
export const prefix = '/onboarding'

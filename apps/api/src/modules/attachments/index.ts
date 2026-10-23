import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { can } from '@devon/contracts'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import {
  attachmentDisposition,
  attachmentMime,
  safeAttachmentName,
  validAttachmentBytes,
} from '../../lib/storage/attachment-types.js'
import { ObjectTooLarge } from '../../lib/storage/object-store.js'
import { ScannerUnavailable } from '../../lib/storage/clamav.js'
import { reserveBufferedTransfer } from '../../lib/storage/buffer-budget.js'
import { contextFromRequest } from '../work/context.js'
import { getCardOwners } from '../work/repo.js'
import * as repo from './repo.js'
import { getPage } from '../pages/repo.js'
import { getConversation } from '../ai/conversations.js'
import {
  APPROVAL_THRESHOLD,
  requestApproval,
  listApprovals,
  reviewApproval,
  ownApprovals,
} from './approvals.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const attachmentParams = paramsSchema.extend({
  attachmentId: z.string().uuid(),
})
const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: z.string(),
})
const subject = (r: FastifyRequest) => ({
  kind: 'department_child' as const,
  departmentId: r.actor?.departmentId ?? '',
})
const audit = (req: FastifyRequest) => ({
  requestId: req.id,
  userId: req.actor!.userId,
  actorRole: req.actor!.role,
  actingForUserId: null,
  ip: req.ip,
  userAgent: req.headers['user-agent'] ?? '',
})

async function allowed(
  req: FastifyRequest,
  reply: FastifyReply,
  cardId: string,
  write = false,
  subjectType: repo.AttachmentSubject = 'card',
) {
  if (subjectType === 'ai_conversation') {
    try {
      await getConversation(contextFromRequest(req), cardId)
      return true
    } catch {
      sendProblem(reply, 'not_found')
      return false
    }
  }
  if (subjectType === 'page') {
    const page = await getPage(req.actor!.departmentId!, cardId, audit(req))
    if (!page) sendProblem(reply, 'not_found')
    return Boolean(page)
  }
  const owners = await getCardOwners(contextFromRequest(req), req.actor!.departmentId!, cardId)
  if (!owners) {
    sendProblem(reply, 'not_found')
    return false
  }
  if (
    write &&
    !can(req.actor, 'update', {
      kind: 'owned',
      departmentId: req.actor!.departmentId!,
      ownerUserIds: owners.ownerUserIds,
    }).allowed
  ) {
    sendProblem(reply, 'forbidden')
    return false
  }
  return true
}

const attachmentRoutes: FastifyPluginAsyncZod = async (app) => {
  // Admit one scan per API process before reading bytes; a busy upload remains retryable.
  const scanState = { finalizing: false }
  app.get(
    '/admin/file-upload-approvals',
    {
      config: {
        permission: {
          action: 'administer',
          subject: () => ({ kind: 'instance' as const }),
        },
      },
      schema: {
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              size: z.number(),
              department: z.string(),
              requester: z.string(),
              subjectType: z.string(),
            }),
          ),
        },
      },
    },
    (req) => listApprovals(contextFromRequest(req)),
  )
  app.post(
    '/admin/file-upload-approvals/:id',
    {
      config: {
        permission: {
          action: 'administer',
          subject: () => ({ kind: 'instance' as const }),
        },
      },
      schema: {
        params: paramsSchema,
        body: z.object({ approved: z.boolean() }).strict(),
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (!(await reviewApproval(contextFromRequest(req), req.params.id, req.body.approved)))
        return sendProblem(reply, 'conflict')
      return reply.code(204).send()
    },
  )
  registerSubjectAttachmentRoutes(app, 'card', scanState)
  registerSubjectAttachmentRoutes(app, 'page', scanState)
  registerSubjectAttachmentRoutes(app, 'ai_conversation', scanState)
}

// Registration is synchronous. Database operations below run only when a request reaches its handler.
function registerSubjectAttachmentRoutes(
  app: Parameters<FastifyPluginAsyncZod>[0],
  subjectType: repo.AttachmentSubject,
  scanState: { finalizing: boolean },
) {
  const routePrefix =
    subjectType === 'card' ? '/cards' : subjectType === 'page' ? '/pages' : '/ai/conversations'
  app.get(
    `${routePrefix}/:id/attachments/approvals`,
    {
      config: { permission: { action: 'read', subject } },
      schema: {
        params: paramsSchema,
        response: {
          200: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
        },
      },
    },
    async (req, reply) => {
      if (!(await allowed(req, reply, req.params.id, false, subjectType))) return
      return ownApprovals(contextFromRequest(req), subjectType, req.params.id)
    },
  )

  app.get(
    `${routePrefix}/:id/attachments`,
    {
      config: { permission: { action: 'read', subject } },
      schema: {
        params: paramsSchema,
        response: { 200: z.array(attachmentSchema) },
      },
    },
    async (req, reply) => {
      if (!(await allowed(req, reply, req.params.id, false, subjectType))) return
      return reply
        .type('application/json')
        .send(await repo.list(contextFromRequest(req), req.params.id, subjectType))
    },
  )

  app.post(
    `${routePrefix}/:id/attachments/upload-url`,
    {
      config: {
        permission: { action: 'update', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        params: paramsSchema,
        body: z
          .object({
            name: z.string().min(1).max(255),
            size: z.number().int().positive(),
          })
          .strict(),
        response: {
          202: z.object({ approvalRequired: z.literal(true) }),
          201: z.object({
            uploadId: z.string(),
            url: z.string(),
            method: z.literal('PUT'),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true, subjectType)))
        return
      const name = safeAttachmentName(req.body.name)
      const mime = attachmentMime(name)
      if (!mime)
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'file', code: 'type' }],
        })
      if (req.body.size > app.storage.maxAttachmentBytes)
        return sendProblem(reply, 'validation_failed', { status: 413 })
      if (
        req.body.size > APPROVAL_THRESHOLD &&
        !(await requestApproval(contextFromRequest(req), {
          subjectType,
          subjectId: req.params.id,
          name,
          size: req.body.size,
        }))
      )
        return reply.code(202).send({ approvalRequired: true as const })
      const id = randomUUID()
      const key = `attachments/${req.actor!.departmentId}/${id}/pending`
      const uploadTtlSeconds = Math.max(
        app.storage.uploadUrlTtlSeconds,
        req.body.size > APPROVAL_THRESHOLD ? 1800 : 300,
      )
      const expiresAt = new Date(app.devon.now().getTime() + uploadTtlSeconds * 1000)
      await app.devon.createUpload(
        {
          id,
          userId: req.actor!.userId,
          purpose: 'card_attachment',
          key,
          mime,
          size: req.body.size,
          expiresAt,
        },
        audit(req),
      )
      await repo.createPending(
        contextFromRequest(req),
        req.params.id,
        {
          id,
          key,
          name,
          mime,
          size: req.body.size,
        },
        subjectType,
      )
      const signed = await app.storage.store.presignPut(key, {
        contentType: mime,
        contentLength: req.body.size,
        expiresInSeconds: uploadTtlSeconds,
        userId: req.actor!.userId,
      })
      return reply.code(201).send({
        uploadId: id,
        ...signed,
        expiresAt: signed.expiresAt.toISOString(),
      })
    },
  )

  app.post(
    `${routePrefix}/:id/attachments/:attachmentId/finalize`,
    {
      config: {
        permission: { action: 'update', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { params: attachmentParams, response: { 200: attachmentSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true, subjectType)))
        return
      const ctx = contextFromRequest(req)
      const attachment = await repo.get(ctx, req.params.id, req.params.attachmentId, subjectType)
      const upload = await app.devon.findOwnUpload(req.params.attachmentId, req.actor!.userId)
      if (
        !attachment ||
        attachment.uploaded_by_user_id !== req.actor!.userId ||
        !upload ||
        upload.purpose !== 'card_attachment'
      )
        return sendProblem(reply, 'not_found')
      if (upload.status !== 'pending') return sendProblem(reply, 'conflict')
      if (upload.expiresAt.getTime() <= app.devon.now().getTime()) return sendProblem(reply, 'gone')
      const reject = async (code: string, infected = false) => {
        await app.devon.markUpload(
          upload.id,
          req.actor!.userId,
          { status: infected ? 'infected' : 'rejected', error: code },
          audit(req),
        )
        await repo.rejectPending(ctx, upload.id, infected)
        await app.storage.store.remove([upload.key])
        return sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'file', code }],
        })
      }
      if (scanState.finalizing) return sendProblem(reply, 'maintenance')
      const releaseWork = reserveBufferedTransfer(
        req,
        reply,
        app.storage.bufferBudget,
        upload.size,
      )?.retain()
      if (!releaseWork) return reply
      scanState.finalizing = true
      try {
        let bytes: Buffer | null
        try {
          bytes = await app.storage.store.get(upload.key, {
            maxBytes: Math.min(upload.size, app.storage.maxAttachmentBytes),
          })
        } catch (err) {
          if (err instanceof ObjectTooLarge) return reject('too_large')
          throw err
        }
        if (!bytes) return sendProblem(reply, 'conflict')
        if (bytes.length !== upload.size) return reject('size_mismatch')
        if (!validAttachmentBytes(attachment.name, bytes)) return reject('type')
        try {
          const verdict = await app.storage.scanner.scan(bytes)
          if (verdict.verdict === 'infected') return reject('infected', true)
        } catch (err) {
          if (err instanceof ScannerUnavailable) return sendProblem(reply, 'maintenance')
          throw err
        }
        // Copy the exact scanned bytes to a different key. A still-valid PUT may overwrite only pending.
        const key = `attachments/${ctx.departmentId}/${upload.id}/${randomUUID()}`
        await app.storage.store.put(key, bytes, 'application/octet-stream')
        const result = await repo.finalize(ctx, req.params.id, upload.id, key, subjectType)
        if (!result) {
          await app.storage.store
            .remove([key])
            .catch((err: unknown) => app.log.warn({ err }, 'attachment cleanup failed'))
          return sendProblem(reply, 'conflict')
        }
        await app.storage.store
          .remove([upload.key])
          .catch((err: unknown) => app.log.warn({ err }, 'attachment quarantine cleanup failed'))
        return reply.type('application/json').send(result)
      } finally {
        scanState.finalizing = false
        releaseWork()
      }
    },
  )

  app.get(
    `${routePrefix}/:id/attachments/:attachmentId/download`,
    {
      config: { permission: { action: 'read', subject } },
      schema: { params: attachmentParams },
    },
    async (req, reply) => {
      if (!(await allowed(req, reply, req.params.id, false, subjectType))) return
      const row = await repo.get(
        contextFromRequest(req),
        req.params.id,
        req.params.attachmentId,
        subjectType,
      )
      if (!row || row.scan_status !== 'clean') return sendProblem(reply, 'not_found')
      const releaseWork = reserveBufferedTransfer(
        req,
        reply,
        app.storage.bufferBudget,
        row.size,
      )?.retain()
      if (!releaseWork) return reply
      try {
        const bytes = await app.storage.store.get(row.key, {
          maxBytes: Math.min(row.size, app.storage.maxAttachmentBytes),
        })
        if (!bytes) return sendProblem(reply, 'not_found')
        return reply
          .header('content-type', 'application/octet-stream')
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'private, no-store')
          .header('content-disposition', attachmentDisposition(row.name))
          .send(bytes)
      } finally {
        releaseWork()
      }
    },
  )

  app.post(
    `${routePrefix}/:id/attachments/:attachmentId/undo-delete`,
    {
      config: { permission: { action: 'update', subject } },
      schema: { params: attachmentParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true, subjectType)))
        return
      if (
        !(await repo.undoRemove(
          contextFromRequest(req),
          req.params.id,
          req.params.attachmentId,
          subjectType,
        ))
      )
        return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.delete(
    `${routePrefix}/:id/attachments/:attachmentId`,
    {
      config: { permission: { action: 'delete', subject } },
      schema: { params: attachmentParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true, subjectType)))
        return
      if (
        !(await repo.remove(
          contextFromRequest(req),
          req.params.id,
          req.params.attachmentId,
          subjectType,
        ))
      )
        return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )
}
export default attachmentRoutes
export const prefix = ''

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
import { contextFromRequest } from '../work/context.js'
import { getCardOwners } from '../work/repo.js'
import * as repo from './repo.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const attachmentParams = paramsSchema.extend({ attachmentId: z.string().uuid() })
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

async function allowed(req: FastifyRequest, reply: FastifyReply, cardId: string, write = false) {
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
  app.get(
    '/cards/:id/attachments',
    {
      config: { permission: { action: 'read', subject } },
      schema: { params: paramsSchema, response: { 200: z.array(attachmentSchema) } },
    },
    async (req, reply) => {
      if (!(await allowed(req, reply, req.params.id))) return
      return reply
        .type('application/json')
        .send(await repo.list(contextFromRequest(req), req.params.id))
    },
  )

  app.post(
    '/cards/:id/attachments/upload-url',
    {
      config: {
        permission: { action: 'update', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        params: paramsSchema,
        body: z
          .object({ name: z.string().min(1).max(255), size: z.number().int().positive() })
          .strict(),
        response: {
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
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true))) return
      const name = safeAttachmentName(req.body.name)
      const mime = attachmentMime(name)
      if (!mime)
        return sendProblem(reply, 'validation_failed', { errors: [{ path: 'file', code: 'type' }] })
      if (req.body.size > app.storage.maxUploadBytes)
        return sendProblem(reply, 'validation_failed', { status: 413 })
      const id = randomUUID()
      const key = `attachments/${req.actor!.departmentId}/${id}/pending`
      const expiresAt = new Date(app.devon.now().getTime() + app.storage.uploadUrlTtlSeconds * 1000)
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
      await repo.createPending(contextFromRequest(req), req.params.id, {
        id,
        key,
        name,
        mime,
        size: req.body.size,
      })
      const signed = await app.storage.store.presignPut(key, {
        contentType: mime,
        expiresInSeconds: app.storage.uploadUrlTtlSeconds,
        userId: req.actor!.userId,
      })
      return reply
        .code(201)
        .send({ uploadId: id, ...signed, expiresAt: signed.expiresAt.toISOString() })
    },
  )

  app.post(
    '/cards/:id/attachments/:attachmentId/finalize',
    {
      config: {
        permission: { action: 'update', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { params: attachmentParams, response: { 200: attachmentSchema } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true))) return
      const ctx = contextFromRequest(req)
      const attachment = await repo.get(ctx, req.params.id, req.params.attachmentId)
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
        return sendProblem(reply, 'validation_failed', { errors: [{ path: 'file', code }] })
      }
      let bytes: Buffer | null
      try {
        bytes = await app.storage.store.get(upload.key, { maxBytes: app.storage.maxUploadBytes })
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
      const result = await repo.finalize(ctx, req.params.id, upload.id, key)
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
    },
  )

  app.get(
    '/cards/:id/attachments/:attachmentId/download',
    {
      config: { permission: { action: 'read', subject } },
      schema: { params: attachmentParams },
    },
    async (req, reply) => {
      if (!(await allowed(req, reply, req.params.id))) return
      const row = await repo.get(contextFromRequest(req), req.params.id, req.params.attachmentId)
      if (!row || row.scan_status !== 'clean') return sendProblem(reply, 'not_found')
      const bytes = await app.storage.store.get(row.key, { maxBytes: app.storage.maxUploadBytes })
      if (!bytes) return sendProblem(reply, 'not_found')
      return reply
        .header('content-type', 'application/octet-stream')
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .header('content-disposition', attachmentDisposition(row.name))
        .send(bytes)
    },
  )

  app.post(
    '/cards/:id/attachments/:attachmentId/undo-delete',
    {
      config: { permission: { action: 'update', subject } },
      schema: { params: attachmentParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true))) return
      if (!(await repo.undoRemove(contextFromRequest(req), req.params.id, req.params.attachmentId)))
        return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )

  app.delete(
    '/cards/:id/attachments/:attachmentId',
    {
      config: { permission: { action: 'delete', subject } },
      schema: { params: attachmentParams },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply) || !(await allowed(req, reply, req.params.id, true))) return
      if (!(await repo.remove(contextFromRequest(req), req.params.id, req.params.attachmentId)))
        return sendProblem(reply, 'not_found')
      return reply.code(204).send()
    },
  )
}
export default attachmentRoutes
export const prefix = ''

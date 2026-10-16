import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { FastifyRequest } from 'fastify'
import type { RequestContext } from '@devon/db'
import { z } from 'zod'
import { checkCsrf } from '../../lib/csrf.js'
import { sendProblem } from '../../lib/problem-reply.js'
import { requestIp, requestUserAgent } from '../../plugins/session.js'
import { ALLOWED_IMAGE_TYPES } from '../../lib/storage/image.js'
import { readableThumbnail } from '../events/thumbnail-repo.js'
import {
  finalizeThumbnail,
  MAX_THUMBNAIL_BYTES,
  requestThumbnailUpload,
} from '../events/thumbnail-service.js'

const params = z.object({ uploadId: z.string().uuid() })
const result = z.object({ uploadId: z.string().uuid(), thumbnailUrl: z.string() })
function context(req: FastifyRequest): RequestContext {
  return {
    requestId: req.id,
    userId: req.actor!.userId,
    actorRole: req.actor!.role,
    departmentId: req.actor!.viewAs?.departmentId ?? req.actor!.departmentId,
    actingForUserId: null,
    viewAs: req.actor!.viewAs != null,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  }
}
const routes: FastifyPluginAsyncZod = async (app) => {
  const subject = (req: FastifyRequest) => ({
    kind: 'department_child' as const,
    departmentId: req.actor?.viewAs?.departmentId ?? req.actor?.departmentId ?? '',
  })
  app.post(
    '/upload-url',
    {
      config: {
        permission: { action: 'create', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        body: z.object({
          contentType: z.enum(ALLOWED_IMAGE_TYPES),
          size: z.number().int().positive().max(MAX_THUMBNAIL_BYTES),
        }),
        response: {
          201: z.object({
            uploadId: z.string().uuid(),
            url: z.string(),
            method: z.literal('PUT'),
            headers: z.record(z.string(), z.string()),
            expiresAt: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      if (req.body.size > app.storage.maxUploadBytes) return sendProblem(reply, 'validation_failed')
      return reply.code(201).send(await requestThumbnailUpload(app, context(req), req.body))
    },
  )
  app.post(
    '/:uploadId/finalize',
    {
      config: {
        permission: { action: 'create', subject },
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: { params, body: z.object({}), response: { 200: result } },
    },
    async (req, reply) => {
      if (!checkCsrf(req, reply)) return
      const finalized = await finalizeThumbnail(app, context(req), req.params.uploadId)
      if (finalized.ok)
        return reply.send({ uploadId: finalized.uploadId, thumbnailUrl: finalized.thumbnailUrl })
      if (finalized.reason === 'not_found') return sendProblem(reply, 'not_found')
      if (finalized.reason === 'scanner_unavailable') {
        reply.header('retry-after', '10')
        return sendProblem(reply, 'maintenance')
      }
      return sendProblem(reply, 'conflict', {
        errors: [{ path: 'thumbnail', code: finalized.reason }],
      })
    },
  )
  app.get(
    '/:uploadId',
    {
      config: { permission: { action: 'read', subject } },
      schema: { params },
    },
    async (req, reply) => {
      const key = await readableThumbnail(context(req), req.params.uploadId)
      if (!key) return sendProblem(reply, 'not_found')
      const bytes = await app.storage.store.get(key, { maxBytes: MAX_THUMBNAIL_BYTES })
      if (!bytes) return sendProblem(reply, 'not_found')
      return reply
        .type('image/webp')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(bytes)
    },
  )
}
export default routes
export const prefix = '/events/thumbnails'

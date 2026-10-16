import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { FastifyInstance } from 'fastify'
import type { RequestContext } from '@devon/db'
import { ScannerUnavailable } from '../../lib/storage/clamav.js'
import { CircuitOpenError } from '../../lib/resilience/circuit-breaker.js'
import { clamav } from '../../lib/resilience/registry.js'
import {
  InvalidImage,
  MAX_INPUT_PIXELS,
  sniffImageType,
  validateImage,
  type AllowedImageType,
} from '../../lib/storage/image.js'
import { ObjectTooLarge } from '../../lib/storage/object-store.js'
import {
  isPreparedThumbnail,
  prepareThumbnail,
  rejectThumbnail,
  thumbnailPrefix,
} from './thumbnail-repo.js'

export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024
export const thumbnailUrl = (id: string): string => `/api/v1/events/thumbnails/${id}`

async function removeQuietly(app: FastifyInstance, key: string): Promise<void> {
  try {
    await app.storage.store.remove([key])
  } catch (err) {
    app.log.warn({ err, key }, 'storage: could not remove event thumbnail object')
  }
}

export async function requestThumbnailUpload(
  app: FastifyInstance,
  ctx: RequestContext,
  input: { contentType: AllowedImageType; size: number },
) {
  const id = randomUUID()
  const key = `${thumbnailPrefix(ctx.departmentId!, id)}pending`
  const upload = await app.devon.createUpload(
    {
      id,
      userId: ctx.userId!,
      purpose: 'event_thumbnail',
      key,
      mime: input.contentType,
      size: input.size,
      expiresAt: new Date(app.devon.now().getTime() + app.storage.uploadUrlTtlSeconds * 1000),
    },
    ctx,
  )
  const presigned = await app.storage.store.presignPut(key, {
    contentType: input.contentType,
    expiresInSeconds: app.storage.uploadUrlTtlSeconds,
    userId: ctx.userId!,
  })
  return { uploadId: upload.id, ...presigned, expiresAt: presigned.expiresAt.toISOString() }
}

export type FinalizeResult =
  | { ok: true; uploadId: string; thumbnailUrl: string }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'expired'
        | 'consumed'
        | 'not_uploaded'
        | 'rejected'
        | 'scanner_unavailable'
    }

export async function finalizeThumbnail(
  app: FastifyInstance,
  ctx: RequestContext,
  uploadId: string,
): Promise<FinalizeResult> {
  const upload = await app.devon.findOwnUpload(uploadId, ctx.userId!)
  if (
    !upload ||
    upload.purpose !== 'event_thumbnail' ||
    !ctx.departmentId ||
    !upload.key.startsWith(thumbnailPrefix(ctx.departmentId, uploadId))
  ) {
    return { ok: false, reason: 'not_found' }
  }
  if (upload.status !== 'pending') return { ok: false, reason: 'consumed' }
  if (upload.expiresAt.getTime() <= app.devon.now().getTime())
    return { ok: false, reason: 'expired' }
  const success = (): FinalizeResult => ({
    ok: true,
    uploadId,
    thumbnailUrl: thumbnailUrl(uploadId),
  })
  if (isPreparedThumbnail(upload.key, ctx.departmentId, uploadId)) return success()
  const { store, scanner } = app.storage
  const reject = async (
    error: string,
    status: 'rejected' | 'infected' = 'rejected',
  ): Promise<FinalizeResult> => {
    const rejected = await rejectThumbnail(ctx, {
      id: uploadId,
      originalKey: upload.key,
      status,
      error,
    })
    if (!rejected) {
      const current = await app.devon.findOwnUpload(uploadId, ctx.userId!)
      if (
        current &&
        ['pending', 'finalized'].includes(current.status) &&
        isPreparedThumbnail(current.key, ctx.departmentId!, uploadId)
      )
        return success()
      return { ok: false, reason: 'consumed' }
    }
    await removeQuietly(app, upload.key)
    return { ok: false, reason: 'rejected' }
  }
  const head = await store.head(upload.key)
  if (!head) return { ok: false, reason: 'not_uploaded' }
  if (head.size !== upload.size) return reject('size_mismatch')
  let bytes: Buffer | null
  try {
    bytes = await store.get(upload.key, {
      maxBytes: Math.min(MAX_THUMBNAIL_BYTES, app.storage.maxUploadBytes),
    })
  } catch (err) {
    if (err instanceof ObjectTooLarge) return reject('too_large')
    throw err
  }
  if (!bytes) return { ok: false, reason: 'not_uploaded' }
  const mime = sniffImageType(bytes)
  if (!mime || mime !== upload.mime) return reject('mime_mismatch')
  try {
    const verdict = await clamav.execute(() => scanner.scan(bytes))
    if (verdict.verdict === 'infected') return reject(verdict.signature, 'infected')
  } catch (err) {
    if (!(err instanceof ScannerUnavailable) && !(err instanceof CircuitOpenError)) throw err
    return { ok: false, reason: 'scanner_unavailable' }
  }
  let derived: Buffer
  try {
    await validateImage(bytes, mime)
    derived = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize(1200, 675, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
  } catch (err) {
    if (err instanceof InvalidImage || err instanceof Error) return reject('decode_failed')
    throw err
  }
  // A unique derived key keeps competing finalizers from overwriting or deleting the winner.
  const key = `${thumbnailPrefix(ctx.departmentId, uploadId)}${randomUUID()}.webp`
  await store.put(key, derived, 'image/webp')
  let prepared: boolean
  try {
    prepared = await prepareThumbnail(ctx, {
      id: uploadId,
      originalKey: upload.key,
      originalMime: upload.mime,
      originalSize: upload.size,
      key,
      size: derived.length,
    })
  } catch (err) {
    await removeQuietly(app, key)
    throw err
  }
  if (!prepared) {
    await removeQuietly(app, key)
    const current = await app.devon.findOwnUpload(uploadId, ctx.userId!)
    if (
      current?.status === 'pending' &&
      current.expiresAt > app.devon.now() &&
      isPreparedThumbnail(current.key, ctx.departmentId, uploadId)
    )
      return success()
    return { ok: false, reason: 'consumed' }
  }
  await removeQuietly(app, upload.key)
  return success()
}

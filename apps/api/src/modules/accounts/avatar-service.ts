// The avatar upload pipeline (TECH-SPEC §2.1: "photo (optional; presigned upload, ClamAV, 512 px WebP
// variants)"). Three steps the routes in `index.ts` expose:
//
//   1. `requestAvatarUpload`  -> an `app.uploads` row + a presigned PUT the browser uploads to directly
//   2. `finalizeAvatar`       -> head/size check -> MIME sniff -> ClamAV -> sharp decode -> 64/128/512
//                               WebP variants -> `users.avatar_key` (one transaction, audited)
//   3. `removeAvatar`         -> `users.avatar_key = null`, objects deleted
//
// "ClamAV before visibility": nothing an upload contains is ever readable by anyone (not even its
// owner) until step 2 has run to completion -- the original object is written under a random key
// nobody is given a GET for, and only the *derived* WebP variants are ever served
// (`GET /accounts/avatar/:userId/:uploadId/:size`). Every non-happy path deletes the original and
// records why on the `app.uploads` row; a scanner outage fails closed (H8.1), it never lets a file
// through unscanned.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { ScannerUnavailable } from '../../lib/storage/clamav.js'
import {
  AVATAR_SIZES,
  InvalidImage,
  makeAvatarVariants,
  sniffImageType,
  validateImage,
  type AllowedImageType,
} from '../../lib/storage/image.js'
import {
  avatarKeyPrefix,
  avatarOriginalKey,
  avatarVariantKey,
  ObjectTooLarge,
  type PresignedUpload,
} from '../../lib/storage/object-store.js'
import type { AuditCtx, UploadRecord, UserRecord } from '../../types.js'

export type RejectCode =
  | 'size_mismatch'
  | 'too_large'
  | 'not_an_image'
  | 'mime_mismatch'
  | 'too_many_pixels'
  | 'decode_failed'

export type AvatarFinalizeResult =
  | { ok: true; user: UserRecord }
  /** No pending avatar upload with that id belongs to this user. */
  | { ok: false; reason: 'not_found' }
  /** The row exists but is no longer `pending` (already finalised, rejected, ...). */
  | { ok: false; reason: 'consumed' }
  /** The presigned URL's window has passed. */
  | { ok: false; reason: 'expired' }
  /** The URL was issued but no bytes ever arrived under its key. */
  | { ok: false; reason: 'not_uploaded' }
  /** Bytes arrived but were not what was declared, or not a decodable image. */
  | { ok: false; reason: 'rejected'; code: RejectCode }
  /** ClamAV matched a signature. The object is already gone. */
  | { ok: false; reason: 'infected'; signature: string }
  /** ClamAV could not be reached or errored. The object is already gone (fail closed). */
  | { ok: false; reason: 'scanner_unavailable' }

/** Every object an avatar prefix can own -- the three served variants plus the original, which is
 * normally deleted right after the variants are written but is listed so a crash in between still
 * gets cleaned up on the next remove/replace. */
export function avatarObjectKeys(prefix: string): string[] {
  return [...AVATAR_SIZES.map((size) => avatarVariantKey(prefix, size)), `${prefix}/original`]
}

/** Deleting objects is never allowed to fail a request that has already committed its row: an
 * orphaned object costs disk, a failed request costs the user their photo. Logged instead. */
async function removeQuietly(app: FastifyInstance, keys: readonly string[]): Promise<void> {
  try {
    await app.storage.store.remove(keys)
  } catch (err) {
    app.log.warn({ err, keys }, 'storage: could not delete objects')
  }
}

export async function requestAvatarUpload(
  app: FastifyInstance,
  userId: string,
  input: { contentType: AllowedImageType; size: number },
  ctx: AuditCtx,
): Promise<{ upload: UploadRecord; presigned: PresignedUpload }> {
  const { store, uploadUrlTtlSeconds } = app.storage
  const id = randomUUID()
  const key = avatarOriginalKey(userId, id)
  const expiresAt = new Date(app.devon.now().getTime() + uploadUrlTtlSeconds * 1000)
  const upload = await app.devon.createUpload(
    { id, userId, purpose: 'avatar', key, mime: input.contentType, size: input.size, expiresAt },
    ctx,
  )
  const presigned = await store.presignPut(key, {
    contentType: input.contentType,
    expiresInSeconds: uploadUrlTtlSeconds,
    userId,
  })
  return { upload, presigned }
}

export async function finalizeAvatar(
  app: FastifyInstance,
  user: UserRecord,
  uploadId: string,
  ctx: AuditCtx,
): Promise<AvatarFinalizeResult> {
  const { store, scanner, maxUploadBytes } = app.storage
  const upload = await app.devon.findOwnUpload(uploadId, user.id)
  if (!upload || upload.purpose !== 'avatar') return { ok: false, reason: 'not_found' }
  if (upload.status !== 'pending') return { ok: false, reason: 'consumed' }

  const reject = async (code: RejectCode): Promise<AvatarFinalizeResult> => {
    await app.devon.markUpload(upload.id, user.id, { status: 'rejected', error: code }, ctx)
    await removeQuietly(app, [upload.key])
    return { ok: false, reason: 'rejected', code }
  }

  if (upload.expiresAt.getTime() <= app.devon.now().getTime()) {
    await app.devon.markUpload(upload.id, user.id, { status: 'expired' }, ctx)
    await removeQuietly(app, [upload.key])
    return { ok: false, reason: 'expired' }
  }

  const head = await store.head(upload.key)
  if (!head) return { ok: false, reason: 'not_uploaded' }
  if (head.size !== upload.size) return reject('size_mismatch')

  let bytes: Buffer | null
  try {
    bytes = await store.get(upload.key, { maxBytes: maxUploadBytes })
  } catch (err) {
    if (err instanceof ObjectTooLarge) return reject('too_large')
    throw err
  }
  if (!bytes) return { ok: false, reason: 'not_uploaded' }

  // Cheapest check first: a file whose first bytes are not the declared format's magic number is
  // rejected before it is ever handed to clamd or libvips (H1.6 "MIME (sniffed)").
  const sniffed = sniffImageType(bytes)
  if (!sniffed) return reject('not_an_image')
  if (sniffed !== upload.mime) return reject('mime_mismatch')

  // ClamAV before anything decodes the bytes (TECH-SPEC §6). A scanner outage is "not clean".
  try {
    const verdict = await scanner.scan(bytes)
    if (verdict.verdict === 'infected') {
      await app.devon.markUpload(
        upload.id,
        user.id,
        { status: 'infected', error: verdict.signature },
        ctx,
      )
      await removeQuietly(app, [upload.key])
      app.log.warn(
        { uploadId: upload.id, signature: verdict.signature },
        'storage: upload rejected by ClamAV',
      )
      return { ok: false, reason: 'infected', signature: verdict.signature }
    }
  } catch (err) {
    if (!(err instanceof ScannerUnavailable)) throw err
    await app.devon.markUpload(
      upload.id,
      user.id,
      { status: 'scan_failed', error: 'scanner_unavailable' },
      ctx,
    )
    await removeQuietly(app, [upload.key])
    app.log.error({ err, uploadId: upload.id }, 'storage: ClamAV unavailable, upload discarded')
    return { ok: false, reason: 'scanner_unavailable' }
  }

  let variants: ReadonlyArray<{ size: number; webp: Buffer }>
  try {
    await validateImage(bytes, upload.mime as AllowedImageType)
    variants = await makeAvatarVariants(bytes)
  } catch (err) {
    if (err instanceof InvalidImage) return reject(err.reason)
    throw err
  }

  const prefix = avatarKeyPrefix(user.id, upload.id)
  // Captured before the write: `user` is the request's own actor record, and a `Deps` implementation
  // is free to hand back (and mutate) that very object.
  const previousAvatarKey = user.avatarKey
  await Promise.all(
    variants.map((v) => store.put(avatarVariantKey(prefix, v.size), v.webp, 'image/webp')),
  )
  // The EXIF-bearing original has served its purpose; only the stripped variants stay.
  await removeQuietly(app, [upload.key])

  const updated = await app.devon.setUserAvatar(
    user.id,
    { avatarKey: prefix, uploadId: upload.id },
    ctx,
  )
  if (previousAvatarKey && previousAvatarKey !== prefix) {
    await removeQuietly(app, avatarObjectKeys(previousAvatarKey))
  }
  return { ok: true, user: updated }
}

export async function removeAvatar(
  app: FastifyInstance,
  user: UserRecord,
  ctx: AuditCtx,
): Promise<UserRecord> {
  const previousAvatarKey = user.avatarKey
  if (!previousAvatarKey) return user
  const updated = await app.devon.setUserAvatar(user.id, { avatarKey: null, uploadId: null }, ctx)
  await removeQuietly(app, avatarObjectKeys(previousAvatarKey))
  return updated
}

/** One retention pass (TECH-SPEC §6 `retention.sweep`): expire pending uploads whose URL window has
 * passed and delete whatever bytes did arrive under them. Returns how many rows were expired. */
export async function sweepExpiredUploads(app: FastifyInstance, limit = 200): Promise<number> {
  const expired = await app.devon.expirePendingUploads(app.devon.now(), limit)
  if (expired.length > 0)
    await removeQuietly(
      app,
      expired.map((u) => u.key),
    )
  return expired.length
}

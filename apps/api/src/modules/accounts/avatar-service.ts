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
// (`GET /accounts/avatar/:userId/:uploadId/:size`). Every non-happy path (rejected, infected)
// deletes the original and records why on the `app.uploads` row -- except a scanner *outage*
// (H8.1), which is not "reject the file", it is "we do not know yet": the upload is left `pending`
// with its bytes intact and `scan-retry-worker.ts` retries it every 30s until either ClamAV answers
// (finalizes or rejects, same as any other request) or the upload's own `expires_at` passes (the
// existing hourly `upload-sweeper.ts` deletes it then, same fail-closed outcome as before, just not
// on the very first outage). The security invariant is unchanged either way: nothing becomes visible
// before a clean verdict actually arrives.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { ScannerUnavailable } from '../../lib/storage/clamav.js'
import { clamav as clamavBreaker } from '../../lib/resilience/registry.js'
import { CircuitOpenError } from '../../lib/resilience/circuit-breaker.js'
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
  /** H8.1: ClamAV could not be reached, the `clamav` circuit breaker is open, or it errored. The
   * upload stays `pending` and its bytes are kept (never marked `rejected`/deleted here) --
   * `scan-retry-worker.ts` retries it automatically; the caller may also just call this endpoint
   * again later with the same `uploadId`. Only a `pending` row that reaches its own `expires_at`
   * without ever getting a clean verdict is deleted, by the existing hourly sweep. */
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

  // ClamAV before anything decodes the bytes (TECH-SPEC §6). H8.1: wrapped in the `clamav` circuit
  // breaker -- while it is open (clamd has failed repeatedly and recently), this throws
  // `CircuitOpenError` immediately instead of waiting out `CLAMAV_TIMEOUT_MS` (20s by default) on a
  // call already known to fail, which matters a lot to `scan-retry-worker.ts` retrying many uploads.
  // The catch below treats it exactly like `ScannerUnavailable` -- both mean "no verdict available".
  try {
    const verdict = await clamavBreaker.execute(() => scanner.scan(bytes))
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
    if (!(err instanceof ScannerUnavailable) && !(err instanceof CircuitOpenError)) throw err
    // H8.1 graceful degradation: an outage is "not yet scanned", not "rejected" -- the row stays
    // `pending` and its bytes are kept so `scan-retry-worker.ts` (or a client simply calling this
    // endpoint again) can finish the job once ClamAV is back, without asking the user to re-upload.
    // A `pending` upload that never gets a clean verdict before `expires_at` is still deleted by the
    // existing hourly sweep (`upload-sweeper.ts`) -- the fail-closed guarantee ("never visible
    // unscanned") is unchanged, only *when* an unrecovered outage gives up has moved from
    // immediately to the upload's normal 10-minute window.
    app.log.warn({ err, uploadId: upload.id }, 'storage: ClamAV unavailable, upload left pending')
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

function scanRetryAuditCtx(): AuditCtx {
  return {
    requestId: `avatar-scan-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: null,
    actorRole: null,
    actingForUserId: null,
    ip: '127.0.0.1',
    userAgent: 'devon-accounts/scan-retry-worker',
  }
}

export type ScanRetrySummary = {
  checked: number
  finalized: number
  /** Still no clean verdict (ClamAV still down, or its bytes have not landed yet) -- tried again
   * next tick, until `expires_at` passes and the hourly sweep removes it. */
  stillPending: number
  /** Anything else `finalizeAvatar` can return (`rejected`, `infected`, `not_uploaded`, `expired`,
   * `consumed`) -- resolved, one way or the other, so no longer this worker's concern. */
  resolvedOtherwise: number
}

/**
 * H8.1 graceful degradation: re-attempts `finalizeAvatar` for every upload the ClamAV-outage path
 * above left `pending` (and, harmlessly, for one whose bytes have simply not arrived yet -- that
 * re-check is exactly as cheap as the one `finalizeAvatar` already does on every call). Run on its
 * own short interval (`scan-retry-worker.ts`, 30s -- far tighter than the hourly expiry sweep) so an
 * upload recovers automatically well inside its 10-minute presigned-URL window whenever ClamAV comes
 * back, instead of only ever being cleaned up by the sweep once it expires. Never throws: one upload
 * failing in a way this function was not expecting is logged and skipped, never lets the rest of the
 * batch go unretried.
 */
export async function retryPendingScans(
  app: FastifyInstance,
  limit = 25,
): Promise<ScanRetrySummary> {
  // Skip the whole batch while the breaker is confirmed open -- otherwise every pending upload would
  // pay the same doomed attempt on every 30s tick during a sustained outage for no benefit.
  if (!clamavBreaker.isCallAllowed()) {
    return { checked: 0, finalized: 0, stillPending: 0, resolvedOtherwise: 0 }
  }

  const pending = await app.devon.listPendingAvatarUploads(limit)
  let finalized = 0
  let stillPending = 0
  let resolvedOtherwise = 0
  for (const { id, userId } of pending) {
    const user = await app.devon.findUserById(userId)
    if (!user) continue // the account was deleted since; the hourly sweep still cleans up its row
    try {
      const result = await finalizeAvatar(app, user, id, scanRetryAuditCtx())
      if (result.ok) finalized += 1
      else if (result.reason === 'scanner_unavailable') stillPending += 1
      else resolvedOtherwise += 1
    } catch (err) {
      app.log.warn({ err, uploadId: id }, 'storage: scan retry failed for one upload, continuing')
    }
  }
  return { checked: pending.length, finalized, stillPending, resolvedOtherwise }
}

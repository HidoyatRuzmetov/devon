// The storage plugin's driver seam (TECH-SPEC §6 `storage`: "presigned PUT, ClamAV before visibility,
// sharp thumbnails, signed 5-minute GETs, filename sanitisation, size/MIME/extension allow-lists").
// Two implementations: `s3-store.ts` (MinIO, or any S3-compatible endpoint -- the production path,
// real presigned PUT/GET URLs) and `local-store.ts` (a plain directory that "presigns" to the API's own
// HMAC-signed routes -- `pnpm start` without the `minio` Compose profile, and every unit test). A route
// handler only ever sees `app.storage.store`; which driver is behind it is `STORAGE_DRIVER`'s business.

export type ObjectHead = { size: number; contentType: string | null }

export type PresignedUpload = {
  url: string
  method: 'PUT'
  /** Headers the browser must send verbatim: they are part of the S3 signature, or of the local
   * driver's token. `content-type` is always among them. */
  headers: Record<string, string>
  expiresAt: Date
}

export type PresignPutOptions = {
  contentType: string
  expiresInSeconds: number
  /** Who this URL is for. The local driver binds its token to the user (and its PUT route also
   * requires that user's session); S3 URLs are bearer URLs by nature and ignore it. */
  userId: string
}

export type PresignGetOptions = { expiresInSeconds: number; userId: string }

export interface ObjectStore {
  readonly driver: 'local' | 's3'
  presignPut(key: string, options: PresignPutOptions): Promise<PresignedUpload>
  presignGet(key: string, options: PresignGetOptions): Promise<string>
  head(key: string): Promise<ObjectHead | null>
  /** The whole object in memory, or `null` when it does not exist. Throws `ObjectTooLarge` past
   * `maxBytes` before reading a single byte past the limit -- what is bounded here is the
   * scan-and-resize pipeline behind it, which is the only caller that ever needs whole bytes. */
  get(key: string, options: { maxBytes: number }): Promise<Buffer | null>
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /** Best-effort, idempotent: a key that no longer exists is not an error. */
  remove(keys: readonly string[]): Promise<void>
  /** Cheap liveness probe for the admin health page / boot log -- never throws. */
  ping(): Promise<boolean>
  /** Releases sockets/handles (H11.1: "sockets closed"). Called from the app's `onClose` hook. */
  close(): Promise<void>
}

export class ObjectTooLarge extends Error {
  constructor(
    public readonly key: string,
    public readonly size: number,
    public readonly maxBytes: number,
  ) {
    super(`object exceeds the ${maxBytes}-byte limit`)
    this.name = 'ObjectTooLarge'
  }
}

export class InvalidObjectKey extends Error {
  constructor() {
    super('invalid object key')
    this.name = 'InvalidObjectKey'
  }
}

/** H1.8 "random storage keys, no user filenames on disk": every key this codebase writes is built by
 * the server from uuids and fixed segment names, so the grammar is deliberately tiny -- lowercase
 * alphanumerics plus `.`/`-`/`_` inside a segment, `/` between non-empty segments, nothing else. A
 * browser-supplied filename never becomes (part of) a key. */
const OBJECT_KEY_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*$/

export function isValidObjectKey(key: string): boolean {
  return key.length > 0 && key.length <= 512 && OBJECT_KEY_RE.test(key) && !key.includes('..')
}

export function assertObjectKey(key: string): void {
  if (!isValidObjectKey(key)) throw new InvalidObjectKey()
}

/** Where avatar objects live: `avatars/<userId>/<uploadId>/{original,64.webp,128.webp,512.webp}`.
 * `users.avatar_key` stores the prefix (`avatars/<userId>/<uploadId>`); consumers append a variant
 * name. Content-addressed by upload id, so a new photo is always a new prefix and every cached URL
 * of the old one is simply gone rather than stale. */
export function avatarKeyPrefix(userId: string, uploadId: string): string {
  return `avatars/${userId}/${uploadId}`
}

export function avatarOriginalKey(userId: string, uploadId: string): string {
  return `${avatarKeyPrefix(userId, uploadId)}/original`
}

export function avatarVariantKey(prefix: string, size: number): string {
  return `${prefix}/${size}.webp`
}

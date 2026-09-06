// Local-disk `ObjectStore` (see `object-store.ts`): objects are files under one directory, and the
// "presigned" URLs point at the API's own `PUT /api/v1/storage/uploads?token=` and
// `GET /api/v1/storage/objects?token=` routes (registered by `plugins/storage.ts`), each guarded by an
// HMAC token (`signed-token.ts`) bound to one key, one method, one user and an expiry. This is what
// `pnpm start` uses out of the box (no `minio` Compose profile needed) and what every unit test uses
// (a temp directory); MinIO (`s3-store.ts`) is the production driver, selected with
// `STORAGE_DRIVER=s3`. Nothing here ever trusts a key it did not sign: `pathFor()` re-validates the
// key grammar and proves the resolved path is still inside `dir` before touching the filesystem.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { assertObjectKey, ObjectTooLarge, type ObjectStore } from './object-store.js'
import {
  deriveSigningKey,
  signToken,
  verifyToken,
  type SignedTokenPayload,
} from './signed-token.js'

export type LocalStoreOptions = {
  /** Absolute or cwd-relative directory. Created on first write. */
  dir: string
  /** Secret the presigned-URL tokens are derived from (`CSRF_SECRET` today, see `config.ts`). */
  signingSecret: string
  /** URL prefix of the plugin's local-driver routes, e.g. `/api/v1/storage`. */
  urlPrefix: string
}

export type LocalStore = ObjectStore & {
  readonly dir: string
  verifyToken(token: string): SignedTokenPayload | null
  /** Absolute path for `key`, guaranteed to lie inside `dir`. Throws on any key that does not. */
  pathFor(key: string): string
}

type Meta = { contentType: string }

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

export function createLocalStore(options: LocalStoreOptions): LocalStore {
  const dir = resolve(options.dir)
  const signingKey = deriveSigningKey(options.signingSecret)

  function pathFor(key: string): string {
    assertObjectKey(key)
    const abs = resolve(dir, key)
    if (!abs.startsWith(dir + sep)) throw new Error('object key escapes the storage directory')
    return abs
  }

  const metaPathFor = (key: string) => `${pathFor(key)}.meta.json`

  async function readMeta(key: string): Promise<Meta | null> {
    try {
      const raw = await readFile(metaPathFor(key), 'utf8')
      const parsed = JSON.parse(raw) as Partial<Meta>
      return typeof parsed.contentType === 'string' ? { contentType: parsed.contentType } : null
    } catch (err) {
      if (isEnoent(err)) return null
      throw err
    }
  }

  async function writeAtomically(target: string, body: Buffer): Promise<void> {
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, body)
      await rename(tmp, target)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
  }

  const store: LocalStore = {
    driver: 'local',
    dir,
    pathFor,
    verifyToken: (token) => verifyToken(token, signingKey),

    async presignPut(key, { contentType, expiresInSeconds, userId }) {
      assertObjectKey(key)
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
      const token = signToken(
        { key, userId, method: 'PUT', contentType, exp: expiresAt.getTime() },
        signingKey,
      )
      return {
        url: `${options.urlPrefix}/uploads?token=${encodeURIComponent(token)}`,
        method: 'PUT',
        headers: { 'content-type': contentType },
        expiresAt,
      }
    },

    async presignGet(key, { expiresInSeconds, userId }) {
      assertObjectKey(key)
      const token = signToken(
        {
          key,
          userId,
          method: 'GET',
          contentType: null,
          exp: Date.now() + expiresInSeconds * 1000,
        },
        signingKey,
      )
      return `${options.urlPrefix}/objects?token=${encodeURIComponent(token)}`
    },

    async head(key) {
      try {
        const s = await stat(pathFor(key))
        if (!s.isFile()) return null
        const meta = await readMeta(key)
        return { size: s.size, contentType: meta?.contentType ?? null }
      } catch (err) {
        if (isEnoent(err)) return null
        throw err
      }
    },

    async get(key, { maxBytes }) {
      const head = await store.head(key)
      if (!head) return null
      if (head.size > maxBytes) throw new ObjectTooLarge(key, head.size, maxBytes)
      try {
        return await readFile(pathFor(key))
      } catch (err) {
        if (isEnoent(err)) return null
        throw err
      }
    },

    async put(key, body, contentType) {
      const target = pathFor(key)
      await writeAtomically(target, body)
      await writeAtomically(
        metaPathFor(key),
        Buffer.from(JSON.stringify({ contentType } satisfies Meta), 'utf8'),
      )
    },

    async remove(keys) {
      await Promise.all(
        keys.flatMap((key) => [
          rm(pathFor(key), { force: true }),
          rm(metaPathFor(key), { force: true }),
        ]),
      )
    },

    async ping() {
      try {
        await mkdir(dir, { recursive: true })
        return true
      } catch {
        return false
      }
    },

    async close() {
      // Nothing held open: every operation opens and closes its own file handle.
    },
  }
  return store
}

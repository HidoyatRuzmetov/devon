// The `storage` plugin (TECH-SPEC §6: "presigned PUT, ClamAV before visibility, sharp thumbnails,
// signed 5-minute GETs, filename sanitisation, size/MIME/extension allow-lists"). Decorates the app
// with `app.storage = { store, scanner, ... }` -- an `ObjectStore` (MinIO via `STORAGE_DRIVER=s3`, or
// the local-disk driver by default) and a `MalwareScanner` (clamd, or the loudly-logged disabled stub
// that `config.ts` refuses in production). Nothing here talks to MinIO or clamd at boot: the first
// upload does, so a `buildApp()` in a unit test never opens a socket and a MinIO that is still
// starting never blocks the API from listening (H8.1 graceful degradation).
//
// The local driver's two routes live here too, because they are the driver's "presigned URL"
// implementation, not a domain feature: `PUT /api/v1/storage/uploads?token=` receives the bytes for a
// token minted by `LocalStore.presignPut`, and `GET /api/v1/storage/objects?token=` serves an object
// for a `presignGet` token. Both require the token's own user to be signed in (the S3 equivalents are
// bearer URLs; the local ones are deliberately stricter), and both go through the same permission
// preHandler as every other route.
import { createReadStream } from 'node:fs'
import { resolve } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Config } from '../config.js'
import { sendProblem } from '../lib/problem-reply.js'
import {
  createClamdScanner,
  createDisabledScanner,
  type MalwareScanner,
} from '../lib/storage/clamav.js'
import { ALLOWED_IMAGE_TYPES } from '../lib/storage/image.js'
import { createLocalStore, type LocalStore } from '../lib/storage/local-store.js'
import type { ObjectStore } from '../lib/storage/object-store.js'
import { createS3Store } from '../lib/storage/s3-store.js'

export type StorageService = {
  store: ObjectStore
  scanner: MalwareScanner
  maxUploadBytes: number
  /** How long a presigned PUT stays valid (also the `app.uploads.expires_at` horizon). */
  uploadUrlTtlSeconds: number
  /** TECH-SPEC §6 "signed 5-minute GETs". */
  getUrlTtlSeconds: number
}

/** Test seam: `buildApp(deps, config, { storage: { scanner } })` swaps in a fake scanner (an
 * "infected" verdict without a real clamd) or a fake store without touching config. */
export type StorageOverrides = { store?: ObjectStore; scanner?: MalwareScanner }

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageService
  }
}

export const UPLOAD_URL_TTL_SECONDS = 10 * 60
export const GET_URL_TTL_SECONDS = 5 * 60
export const LOCAL_ROUTE_PREFIX = '/api/v1/storage'

export function buildStore(config: Config): ObjectStore {
  if (config.STORAGE_DRIVER === 's3') {
    const { STORAGE_S3_ENDPOINT, STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY } = config
    if (!STORAGE_S3_ENDPOINT || !STORAGE_S3_ACCESS_KEY || !STORAGE_S3_SECRET_KEY) {
      // `loadConfig` already refuses this combination; this is the type-level echo of that refusal.
      throw new Error('STORAGE_DRIVER=s3 needs STORAGE_S3_ENDPOINT, _ACCESS_KEY and _SECRET_KEY')
    }
    return createS3Store({
      endpoint: STORAGE_S3_ENDPOINT,
      publicEndpoint: config.STORAGE_S3_PUBLIC_ENDPOINT,
      region: config.STORAGE_S3_REGION,
      bucket: config.STORAGE_S3_BUCKET,
      accessKeyId: STORAGE_S3_ACCESS_KEY,
      secretAccessKey: STORAGE_S3_SECRET_KEY,
      forcePathStyle: config.STORAGE_S3_FORCE_PATH_STYLE,
      timeoutMs: config.STORAGE_TIMEOUT_MS,
    })
  }
  return createLocalStore({
    dir: resolve(config.STORAGE_LOCAL_DIR),
    // Derived, never used raw (see `signed-token.ts`), so sharing the CSRF secret costs nothing and
    // spares `.env` a second mandatory secret.
    signingSecret: config.CSRF_SECRET,
    urlPrefix: LOCAL_ROUTE_PREFIX,
  })
}

export function buildScanner(config: Config): MalwareScanner {
  if (config.CLAMAV_MODE === 'clamd') {
    return createClamdScanner({
      host: config.CLAMAV_HOST,
      port: config.CLAMAV_PORT,
      timeoutMs: config.CLAMAV_TIMEOUT_MS,
    })
  }
  return createDisabledScanner()
}

// The token rides in the query string, like an S3 presigned URL's signature: Fastify caps a *path*
// parameter at `maxParamLength` (100 chars) and answers 414 past it, and a signed payload is longer.
const tokenQuerySchema = z.object({ token: z.string().min(1).max(4096) }).strict()

function registerLocalRoutes(
  instance: FastifyInstance,
  store: LocalStore,
  maxUploadBytes: number,
): void {
  const app = instance.withTypeProvider<ZodTypeProvider>()
  const ownAccount = (r: FastifyRequest) => ({
    kind: 'own_account' as const,
    userId: r.actor?.userId ?? '',
  })

  // Raw-body parser for exactly the allowed image types, bounded by the upload limit before a byte
  // past it is buffered. No other route in the app accepts an image body, so registering this on the
  // root context (this plugin is fastify-plugin-wrapped) changes nothing for JSON routes.
  app.addContentTypeParser(
    [...ALLOWED_IMAGE_TYPES],
    { parseAs: 'buffer', bodyLimit: maxUploadBytes },
    (_req, body, done) => done(null, body),
  )

  app.put(
    `${LOCAL_ROUTE_PREFIX}/uploads`,
    {
      config: { permission: { action: 'update', subject: ownAccount } },
      bodyLimit: maxUploadBytes,
      schema: { querystring: tokenQuerySchema },
    },
    async (req, reply) => {
      const payload = store.verifyToken(req.query.token)
      // Unknown, expired, wrong-method or someone else's token all look identical: a 404, never a 403
      // that would confirm the token exists.
      if (!payload || payload.method !== 'PUT' || payload.userId !== req.actor!.userId) {
        sendProblem(reply, 'not_found')
        return
      }
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      if (!payload.contentType || contentType !== payload.contentType) {
        sendProblem(reply, 'validation_failed', {
          errors: [{ path: 'content-type', code: 'mismatch' }],
        })
        return
      }
      const body: unknown = req.body
      if (!Buffer.isBuffer(body) || body.length === 0) {
        sendProblem(reply, 'validation_failed', { errors: [{ path: 'body', code: 'empty' }] })
        return
      }
      await store.put(payload.key, body, payload.contentType)
      reply.code(204).send()
    },
  )

  app.get(
    `${LOCAL_ROUTE_PREFIX}/objects`,
    {
      config: { permission: { action: 'read', subject: ownAccount } },
      schema: { querystring: tokenQuerySchema },
    },
    async (req, reply) => {
      const payload = store.verifyToken(req.query.token)
      if (!payload || payload.method !== 'GET' || payload.userId !== req.actor!.userId) {
        sendProblem(reply, 'not_found')
        return
      }
      const head = await store.head(payload.key)
      if (!head) {
        sendProblem(reply, 'not_found')
        return
      }
      reply
        .header('content-type', head.contentType ?? 'application/octet-stream')
        .header('content-length', head.size)
        .header('cache-control', 'private, max-age=300')
        .header('x-content-type-options', 'nosniff')
        // A signed GET is a download, exactly like the S3 driver's `ResponseContentDisposition`.
        .header('content-disposition', 'attachment')
        .send(createReadStream(store.pathFor(payload.key)))
    },
  )
}

export default fp<{ overrides?: StorageOverrides }>(async function storagePlugin(app, opts) {
  const config = app.devonConfig
  const store = opts.overrides?.store ?? buildStore(config)
  const scanner = opts.overrides?.scanner ?? buildScanner(config)

  app.decorate('storage', {
    store,
    scanner,
    maxUploadBytes: config.STORAGE_MAX_UPLOAD_BYTES,
    uploadUrlTtlSeconds: UPLOAD_URL_TTL_SECONDS,
    getUrlTtlSeconds: GET_URL_TTL_SECONDS,
  } satisfies StorageService)

  if (scanner.mode === 'off') {
    app.log.warn(
      'CLAMAV_MODE=off: uploaded files are NOT scanned for malware. This is a developer-machine ' +
        'setting only -- production boots refuse it (config.ts). Start the clamav Compose profile ' +
        'and set CLAMAV_MODE=clamd to scan uploads (TECH-SPEC §6, HARDENING 1.8).',
    )
  }
  app.log.info(
    {
      driver: store.driver,
      scanner: scanner.mode,
      maxUploadBytes: config.STORAGE_MAX_UPLOAD_BYTES,
    },
    'storage plugin ready',
  )

  if (store.driver === 'local') {
    registerLocalRoutes(app, store as LocalStore, config.STORAGE_MAX_UPLOAD_BYTES)
  }

  app.addHook('onClose', async () => {
    await store.close()
  })
})

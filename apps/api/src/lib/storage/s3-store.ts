// S3-compatible `ObjectStore` (see `object-store.ts`) -- MinIO in `infra/docker-compose.yml`'s `minio`
// profile (TECH-SPEC §1.2/§13), or any other S3 endpoint. The production driver: a real presigned PUT
// the browser uploads to directly, a real presigned 5-minute GET for anything that must be fetched
// out-of-band, and server-side head/get/put/delete for the scan-and-resize pipeline.
//
// Every call carries a timeout (H8.1: "timeouts ... for ... MinIO") twice over: the SDK's own request
// handler timeout, and an `AbortSignal.timeout` on each `send`, so a hung socket can never hold a
// request handler open indefinitely. Two clients exist because a presigned URL's signature covers the
// host the browser will call: `STORAGE_S3_PUBLIC_ENDPOINT` (what the browser can reach -- Caddy's
// `/storage` route, or `http://localhost:9000` in dev) may legitimately differ from
// `STORAGE_S3_ENDPOINT` (what the API reaches over the Compose network).
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { assertObjectKey, ObjectTooLarge, type ObjectStore } from './object-store.js'
import { storage as storageBreaker } from '../resilience/registry.js'

export type S3StoreOptions = {
  endpoint: string
  publicEndpoint?: string | undefined
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  timeoutMs: number
}

function statusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return (
    statusOf(err) === 404 || name === 'NotFound' || name === 'NoSuchKey' || name === 'NoSuchBucket'
  )
}

export function createS3Store(options: S3StoreOptions): ObjectStore {
  const { bucket, timeoutMs } = options
  const clientConfig = {
    region: options.region,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    forcePathStyle: options.forcePathStyle,
    requestHandler: { requestTimeout: timeoutMs, connectionTimeout: Math.min(timeoutMs, 5000) },
  }
  const client = new S3Client({ ...clientConfig, endpoint: options.endpoint })
  const presignClient = options.publicEndpoint
    ? new S3Client({ ...clientConfig, endpoint: options.publicEndpoint })
    : client

  const signal = () => AbortSignal.timeout(timeoutMs)

  // Memoised so the bucket probe happens once per process, and reset on failure so a MinIO that was
  // down at boot is retried on the next upload instead of being wedged into a permanent error.
  // H8.1: wrapped in the `storage` circuit breaker -- a HeadBucket 404 (bucket not created yet) is
  // handled here and is not itself a MinIO-outage signal, so it must not reach the breaker as a
  // thrown error; only a genuine failure of either call does.
  let bucketReady: Promise<void> | null = null
  function ensureBucket(): Promise<void> {
    if (!bucketReady) {
      bucketReady = storageBreaker.execute(async () => {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal() })
        } catch (err) {
          if (!isNotFound(err)) throw err
          await client.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: signal() })
        }
      })
      bucketReady.catch(() => {
        bucketReady = null
      })
    }
    return bucketReady
  }

  const store: ObjectStore = {
    driver: 's3',

    async presignPut(key, { contentType, expiresInSeconds }) {
      assertObjectKey(key)
      await ensureBucket()
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
      const url = await getSignedUrl(
        presignClient,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        {
          expiresIn: expiresInSeconds,
          // The presigner signs only `host` unless told otherwise; naming `content-type` here makes
          // it part of the signature, so a PUT with any other type is refused by MinIO itself
          // (`test/checks/storage-s3-prove.ts` asserts exactly that). `headers` below is what the
          // browser must therefore send verbatim.
          signableHeaders: new Set(['content-type']),
        },
      )
      return { url, method: 'PUT', headers: { 'content-type': contentType }, expiresAt }
    },

    async presignGet(key, { expiresInSeconds }) {
      assertObjectKey(key)
      return getSignedUrl(
        presignClient,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          // Never rendered inline straight from the store: a signed GET is a download, not a page.
          ResponseContentDisposition: 'attachment',
        }),
        { expiresIn: expiresInSeconds },
      )
    },

    // H8.1: every network call below is wrapped in the `storage` circuit breaker -- `isNotFound` is
    // handled *inside* the wrapped function (returning `null`, not throwing) precisely so an ordinary
    // "no such object" answer never counts as a MinIO-outage failure; only a genuine transport/HTTP
    // error does. A confirmed outage then fails every subsequent call immediately rather than each
    // one separately waiting out `timeoutMs`.
    async head(key) {
      assertObjectKey(key)
      return storageBreaker.execute(async () => {
        try {
          const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal: signal(),
          })
          return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null }
        } catch (err) {
          if (isNotFound(err)) return null
          throw err
        }
      })
    },

    async get(key, { maxBytes }) {
      const head = await store.head(key)
      if (!head) return null
      if (head.size > maxBytes) throw new ObjectTooLarge(key, head.size, maxBytes)
      // `ObjectTooLarge` is deliberately checked OUTSIDE `storageBreaker.execute()` below (both
      // above, on the declared `Content-Length`, and again here on the actual byte count): it is the
      // caller's own size limit being exceeded, never a MinIO-outage signal, and must never trip the
      // breaker the way a real transport failure does.
      const bytes = await storageBreaker.execute(async () => {
        try {
          const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal: signal(),
          })
          if (!res.Body) return null
          return Buffer.from(await res.Body.transformToByteArray())
        } catch (err) {
          if (isNotFound(err)) return null
          throw err
        }
      })
      if (bytes && bytes.byteLength > maxBytes)
        throw new ObjectTooLarge(key, bytes.byteLength, maxBytes)
      return bytes
    },

    async put(key, body, contentType) {
      assertObjectKey(key)
      await ensureBucket()
      await storageBreaker.execute(() =>
        client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
          { abortSignal: signal() },
        ),
      )
    },

    async remove(keys) {
      if (keys.length === 0) return
      for (const key of keys) assertObjectKey(key)
      // S3 caps a single DeleteObjects call at 1000 keys; chunk so a large batch is still one request
      // per thousand rather than one per key (TECH-SPEC §16: "no query in a loop").
      const chunks: string[][] = []
      for (let i = 0; i < keys.length; i += 1000) chunks.push(keys.slice(i, i + 1000))
      await Promise.all(
        chunks.map((chunk) =>
          storageBreaker.execute(() =>
            client.send(
              new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
              }),
              { abortSignal: signal() },
            ),
          ),
        ),
      )
    },

    async ping() {
      try {
        await ensureBucket()
        return true
      } catch {
        return false
      }
    },

    async close() {
      client.destroy()
      if (presignClient !== client) presignClient.destroy()
    },
  }
  return store
}

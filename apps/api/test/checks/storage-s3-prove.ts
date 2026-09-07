// The `s3` object-store driver (`src/lib/storage/s3-store.ts`) against a REAL MinIO -- the one
// `infra/docker-compose.yml`'s `minio` profile starts (`docker compose -f infra/docker-compose.yml
// --profile minio up -d`). Proves what no unit test can: that a presigned PUT this driver mints is
// accepted by MinIO's SigV4 check with the exact headers the browser will send, that head/get/put/
// delete round-trip, that a presigned GET works and a tampered one is refused, and that the bucket is
// created on first use. Env (all default to the Compose file's dev placeholders):
//   STORAGE_S3_ENDPOINT, STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY, STORAGE_S3_BUCKET
// Run with `pnpm --filter @devon/api storage:prove`.
import { randomBytes, randomUUID } from 'node:crypto'
import { createS3Store } from '../../src/lib/storage/s3-store.js'
import { avatarOriginalKey, ObjectTooLarge } from '../../src/lib/storage/object-store.js'
import { step, assertEqual, assertTrue } from './http.js'

async function main(): Promise<void> {
  const store = createS3Store({
    endpoint: process.env['STORAGE_S3_ENDPOINT'] ?? 'http://127.0.0.1:9000',
    region: process.env['STORAGE_S3_REGION'] ?? 'us-east-1',
    bucket: process.env['STORAGE_S3_BUCKET'] ?? `devon-prove-${randomUUID().slice(0, 8)}`,
    accessKeyId: process.env['STORAGE_S3_ACCESS_KEY'] ?? 'devon_minio_admin',
    secretAccessKey: process.env['STORAGE_S3_SECRET_KEY'] ?? 'devon_local_dev_minio_change_me', // example value: compose placeholder, dev only
    forcePathStyle: true,
    timeoutMs: 10_000,
  })

  try {
    await run(store)
  } finally {
    await store.close()
  }
}

async function run(store: ReturnType<typeof createS3Store>): Promise<void> {
  step('ping() reaches MinIO and creates the bucket on first use')
  assertEqual(await store.ping(), true, 'ping')

  const userId = randomUUID()
  const uploadId = randomUUID()
  const key = avatarOriginalKey(userId, uploadId)
  const bytes = randomBytes(100 * 1024 + 3)

  step('presignPut -> the browser-side PUT (plain fetch, no credentials) is accepted by MinIO')
  const presigned = await store.presignPut(key, {
    contentType: 'image/png',
    expiresInSeconds: 120,
    userId,
  })
  assertTrue(presigned.url.includes('X-Amz-Signature='), 'URL carries a SigV4 signature')
  const put = await fetch(presigned.url, {
    method: presigned.method,
    headers: presigned.headers,
    body: bytes,
    credentials: 'omit',
  })
  assertEqual(put.status, 200, 'presigned PUT status')

  step('a PUT with a different content type than the URL was signed for is refused')
  const wrongType = await fetch(presigned.url, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: bytes,
  })
  assertEqual(wrongType.status, 403, 'mismatched content-type PUT status')

  step('head / get see exactly what was uploaded')
  const head = await store.head(key)
  assertEqual(head?.size, bytes.length, 'head size')
  assertEqual(head?.contentType, 'image/png', 'head content type')
  const got = await store.get(key, { maxBytes: 5 * 1024 * 1024 })
  assertTrue(got !== null && got.equals(bytes), 'get returns identical bytes')
  let tooLarge = false
  try {
    await store.get(key, { maxBytes: 1024 })
  } catch (err) {
    tooLarge = err instanceof ObjectTooLarge
  }
  assertTrue(tooLarge, 'get refuses an object past maxBytes')

  step('put (server-side) + presignGet -> a 5-minute download URL; tampering is refused')
  const variantKey = `avatars/${userId}/${uploadId}/64.webp`
  await store.put(variantKey, Buffer.from('RIFF....WEBP'), 'image/webp')
  const getUrl = await store.presignGet(variantKey, { expiresInSeconds: 300, userId })
  const download = await fetch(getUrl)
  assertEqual(download.status, 200, 'presigned GET status')
  assertEqual(download.headers.get('content-type'), 'image/webp', 'presigned GET content type')
  assertEqual(
    download.headers.get('content-disposition'),
    'attachment',
    'presigned GET is a download',
  )
  const tampered = await fetch(getUrl.replace('64.webp', 'original'))
  assertEqual(tampered.status, 403, 'tampered presigned GET status')

  step('remove is idempotent and leaves nothing behind')
  await store.remove([key, variantKey, `avatars/${userId}/never/existed`])
  assertEqual(await store.head(key), null, 'original gone')
  assertEqual(await store.head(variantKey), null, 'variant gone')

  console.log('\nstorage:prove PASSED')
}

main().catch((err: unknown) => {
  console.error('\nstorage:prove FAILED')
  console.error(err)
  process.exit(1)
})

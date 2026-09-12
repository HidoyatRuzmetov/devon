// H8.1/H13.1: proves the `storage` circuit breaker (`lib/resilience/registry.ts`, wired into
// `lib/storage/s3-store.ts`) against a REAL, stopped MinIO -- what no unit test can, exactly like
// `storage-s3-prove.ts` proves the happy path against a real, running one. Requires MinIO to actually
// be down for the whole run:
//   docker stop devon-minio
//   pnpm --filter @devon/api storage:breaker:prove
//   docker start devon-minio
import { createS3Store } from '../../src/lib/storage/s3-store.js'
import { circuitSnapshots, __resetAllCircuitsForTests } from '../../src/lib/resilience/registry.js'
import { step, assertEqual, assertTrue } from './http.js'

async function main(): Promise<void> {
  __resetAllCircuitsForTests()
  const store = createS3Store({
    endpoint: process.env['STORAGE_S3_ENDPOINT'] ?? 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'devon-breaker-prove',
    accessKeyId: process.env['STORAGE_S3_ACCESS_KEY'] ?? 'devon_minio_admin',
    secretAccessKey: process.env['STORAGE_S3_SECRET_KEY'] ?? 'devon_local_dev_minio_change_me', // example value: compose placeholder, dev only
    forcePathStyle: true,
    timeoutMs: 2000, // short on purpose, so a closed breaker's failing calls do not take minutes
  })

  try {
    step('with MinIO down, ping() fails and the breaker is still closed after one failure')
    const first = await timedPing(store)
    assertEqual(first.ok, false, 'ping (down) ok')
    assertEqual(circuitSnapshots().storage.state, 'closed', 'breaker state after 1 failure')
    assertEqual(circuitSnapshots().storage.consecutiveFailures, 1, 'consecutiveFailures after 1')

    for (let i = 0; i < 4; i++) await store.ping() // the `storage` breaker trips at 5 consecutive failures

    step('once 5 consecutive failures have happened, the breaker is open')
    assertEqual(circuitSnapshots().storage.state, 'open', 'breaker state after 5 failures')

    step('an open breaker fails every further call immediately, without a new attempt')
    // A container that is fully stopped refuses the connection instantly either way (ECONNREFUSED,
    // no timeout to wait out) -- what distinguishes "open" from "closed" here is `lastFailureAt`
    // itself, not wall-clock time: a `guard()` rejection never reaches `fail()`, so it never advances.
    const beforeOpenCall = circuitSnapshots().storage.lastFailureAt
    const fast = await timedPing(store)
    assertEqual(fast.ok, false, 'ping (breaker open) ok')
    assertEqual(circuitSnapshots().storage.lastFailureAt, beforeOpenCall, 'lastFailureAt unchanged')
    assertTrue(fast.ms < 50, `open-breaker ping returned near-instantly (${fast.ms}ms < 50ms)`)

    console.log('\nstorage-breaker:prove PASSED (MinIO was down for the whole run, as required)')
  } finally {
    await store.close()
  }
}

async function timedPing(store: {
  ping(): Promise<boolean>
}): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now()
  const ok = await store.ping()
  return { ok, ms: Date.now() - start }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performanceEnvironment, assertPerformancePortAvailable } from './local-config.mjs'
import { runChecks } from './check.mjs'
import { buildPerformanceWeb } from './web-build.mjs'

const root = resolve(import.meta.dirname, '../..')
const env = performanceEnvironment(process.env)
await Promise.all([
  assertPerformancePortAvailable(Number(env.FLOW_API_PORT)),
  assertPerformancePortAvailable(Number(env.FLOW_WEB_PORT)),
  assertPerformancePortAvailable(Number(env.FLOW_DB_PORT)),
])
// Imported flow constants must see only the guarded, owned namespace and credentials.
process.env = env
await buildPerformanceWeb(root, env)
const { startPerformanceDatabase } = await import('./local-database.mts')
const database = await startPerformanceDatabase(env)
let teardown: (() => Promise<void>) | undefined
let web: { stop: () => Promise<void> } | undefined
const output = resolve(root, 'tools/perf/lighthouse/out')
mkdirSync(output, { recursive: true })
const serviceReceipt = resolve(output, 'local-service-evidence.json')
const snapshots: unknown[] = []
function captureServices() {
  snapshots.push(database.snapshot())
  writeFileSync(serviceReceipt, JSON.stringify({ snapshots, removed: false }, null, 2))
}
try {
  const [{ default: setup }, { spawnManaged, waitForHttp }, flow] = await Promise.all([
    import('../../apps/web/test/e2e/global-setup.js'),
    import('../../apps/web/test/e2e/flow-process.js'),
    import('../../apps/web/test/e2e/flow-env.js'),
  ])
  teardown = await setup()
  web = spawnManaged('pnpm', ['--filter', '@devon/web', 'preview', '--mode', 'test'], {
    cwd: root,
    env: { ...env, API_PORT: env.FLOW_API_PORT, WEB_PORT: env.FLOW_WEB_PORT },
    logFile: resolve(output, 'local-web.log'),
  })
  if (!(await waitForHttp(flow.FLOW_WEB_BASE_URL, 60_000)))
    throw new Error('Owned performance web fixture did not start')
  if (!(await waitForHttp(`${flow.FLOW_API_BASE_URL}/healthz`, 5_000)))
    throw new Error('Owned performance API fixture stopped')
  console.log('[perf:check] guarded real API/web and synthetic fixtures ready')
  captureServices()
  process.exitCode = (await runChecks(Number(env.FLOW_API_PORT), Number(env.FLOW_WEB_PORT))) ? 0 : 1
  captureServices()
} finally {
  try {
    await web?.stop()
  } finally {
    try {
      await teardown?.()
    } finally {
      await database.stop()
      writeFileSync(serviceReceipt, JSON.stringify({ snapshots, removed: true }, null, 2))
    }
  }
}

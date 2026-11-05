// Local, synthetic review only. The owned QA database is recreated on startup; production is never used.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:net'

const root = resolve(import.meta.dirname, '../..')
const directory = resolve(root, 'artifacts/review/2026-11-05')
const apiPort = 48921
const webPort = 48922
for (const port of [apiPort, webPort]) {
  await new Promise<void>((accept, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(port, '127.0.0.1', () => probe.close(() => accept()))
  })
}
process.env['FLOW_DB_NAME'] = 'devon_qa_workspace_review'
process.env['FLOW_API_PORT'] = String(apiPort)
process.env['FLOW_WEB_PORT'] = String(webPort)
process.env['FLOW_DB_HOST'] = '127.0.0.1'
process.env['FLOW_DB_PORT'] = '55432'
process.env['FLOW_DB_CONTAINER'] = 'devon-postgres'
process.env['FLOW_SEED_DEMO'] = '1'
process.env['DEVON_E2E'] = '0'

const { localFlowEnvironment } = await import('../../apps/web/test/e2e/flow-safety.js')
process.env = localFlowEnvironment(
  process.env,
  {},
  resolve(root, 'apps/web/test/e2e/.tmp/devon_qa_workspace_review/storage'),
)
const { default: setup } = await import('../../apps/web/test/e2e/global-setup.js')
const { spawnManaged, waitForHttp } = await import('../../apps/web/test/e2e/flow-process.js')
await mkdir(directory, { recursive: true })
const teardown = await setup()
const web = spawnManaged('pnpm', ['--filter', '@devon/web', 'dev', '--mode', 'test'], {
  cwd: root,
  env: { ...process.env, API_PORT: String(apiPort), WEB_PORT: String(webPort) },
  logFile: resolve(directory, 'preview-web.log'),
})
let closing = false
async function close(exitCode = 0) {
  if (closing) return
  closing = true
  await web.stop()
  await teardown()
  process.exit(exitCode)
}
process.on('SIGINT', () => {
  void close()
})
process.on('SIGTERM', () => {
  void close()
})
if (!(await waitForHttp(`http://127.0.0.1:${webPort}`, 60_000))) {
  console.error('Local review web server did not start')
  await close(1)
}
await writeFile(
  resolve(directory, 'preview.json'),
  JSON.stringify(
    {
      pid: process.pid,
      url: `http://127.0.0.1:${webPort}/work/person`,
      database: process.env['FLOW_DB_NAME'],
      synthetic: true,
      externalMessaging: false,
    },
    null,
    2,
  ),
)
console.log(`Local review: http://127.0.0.1:${webPort}/work/person`)
console.log('Synthetic demo accounts only. Telegram and external AI are disabled.')
await new Promise<void>(() => {})

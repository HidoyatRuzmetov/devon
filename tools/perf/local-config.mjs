import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import {
  assertLocalTestDatabase,
  assertTestPort,
  localFlowEnvironment,
} from '../../apps/web/test/e2e/flow-safety.ts'

export const PERF_DATABASE = 'devon_qa_perf_gate'
export const PERF_DATABASE_PORT = 55471

export function assertPerformanceDatabaseEnvironment(env) {
  const run = env.DEVON_PERF_RUN
  if (
    !run ||
    !/^[a-f0-9]{12}$/.test(run) ||
    env.FLOW_DB_NAME !== PERF_DATABASE ||
    env.FLOW_DB_HOST !== '127.0.0.1' ||
    env.FLOW_DB_PORT !== String(PERF_DATABASE_PORT) ||
    env.FLOW_DB_CONTAINER !== `flow-${PERF_DATABASE}-${run}-postgres` ||
    env.DEVON_PERF_LOCAL_FIXTURES !== '1'
  )
    throw new Error('Performance database refuses a shared, remote or unowned service')
}

export function performanceEnvironment(inherited, run = randomBytes(6).toString('hex')) {
  if (!/^[a-f0-9]{12}$/.test(run)) throw new Error('Invalid performance service run identity')
  const env = { ...inherited }
  for (const key of Object.keys(env)) if (/^(K6_|DEVON_PERF_)/.test(key)) delete env[key]
  const apiPort = Number(env.FLOW_API_PORT ?? 48981)
  const webPort = Number(env.FLOW_WEB_PORT ?? 48982)
  assertTestPort(apiPort)
  assertTestPort(webPort)
  if (apiPort === webPort) throw new Error('Performance API and web ports must differ')
  assertLocalTestDatabase({
    host: env.FLOW_DB_HOST ?? '127.0.0.1',
    database: PERF_DATABASE,
    container: env.FLOW_DB_CONTAINER ?? 'devon-postgres',
    port: Number(env.FLOW_DB_PORT ?? 55432),
  })
  return localFlowEnvironment(
    env,
    {
      FLOW_DB_NAME: PERF_DATABASE,
      // Never attach fixture writes to the ordinary development/shared QA cluster.
      FLOW_DB_HOST: '127.0.0.1',
      FLOW_DB_PORT: String(PERF_DATABASE_PORT),
      FLOW_DB_CONTAINER: `flow-${PERF_DATABASE}-${run}-postgres`,
      DEVON_PERF_RUN: run,
      FLOW_API_PORT: String(apiPort),
      FLOW_WEB_PORT: String(webPort),
      FLOW_SEED_DEMO: '1',
      FLOW_REALTIME: '0',
      FLOW_PRODUCTION_BUILD: '1',
      DEVON_E2E: '0',
      DEVON_PERF_LOCAL_FIXTURES: '1',
      DEVON_PERF_DB_NAME: PERF_DATABASE,
      K6_NO_USAGE_REPORT: 'true',
      DO_NOT_TRACK: '1',
    },
    resolve(import.meta.dirname, `../../apps/web/test/e2e/.tmp/${PERF_DATABASE}/storage`),
  )
}

export function assertPerformancePortAvailable(port) {
  assertTestPort(port)
  return new Promise((done, reject) => {
    const server = createServer()
    server.once('error', () =>
      reject(new Error(`Performance tests refuse an occupied loopback port: ${port}`)),
    )
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      server.close((error) => (error ? reject(error) : done())),
    )
  })
}

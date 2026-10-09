import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  assertPerformanceDatabaseEnvironment,
  PERF_DATABASE,
  PERF_DATABASE_PORT,
} from './local-config.mjs'
import {
  assertLocalDockerEndpoint,
  assertOwnedFlowService,
  type OwnedFlowService,
} from '../../apps/web/test/e2e/flow-services.js'

const IMAGE =
  'pgvector/pgvector:0.8.6-pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f'

function docker(args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 30_000,
    ...(env ? { env } : {}),
  })
  if (result.status !== 0)
    throw new Error(`Owned performance Docker ${args[0]} failed: ${result.stderr.slice(-1200)}`)
  return result.stdout.trim()
}

function assertLocalDocker(): void {
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  assertLocalDockerEndpoint(
    docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']),
  )
}

function inspectOwned(descriptor: OwnedFlowService): void {
  assertLocalDocker()
  // Do not inspect/output Config.Env: it contains the ephemeral database credential.
  const value = JSON.parse(
    docker([
      'container',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}}}',
      descriptor.id,
    ]),
  ) as { id: string; name: string; labels: Record<string, string> }
  assertOwnedFlowService(descriptor, value)
}

/** A fresh, pinned local cluster removes this workload from shared QA connection limits. */
export async function startPerformanceDatabase(env: NodeJS.ProcessEnv): Promise<{
  stop: () => Promise<void>
  descriptor: OwnedFlowService
  snapshot: () => unknown
}> {
  assertPerformanceDatabaseEnvironment(env)
  assertLocalDocker()
  const run = env['DEVON_PERF_RUN']!
  const name = env['FLOW_DB_CONTAINER']!
  const id = docker(
    [
      'run',
      '-d',
      '--pull=never',
      '--name',
      name,
      '--label',
      `devon.qa.namespace=${PERF_DATABASE}`,
      '--label',
      `devon.qa.run=${run}`,
      '--publish',
      `127.0.0.1:${PERF_DATABASE_PORT}:5432`,
      '--env',
      'POSTGRES_PASSWORD',
      IMAGE,
    ],
    { ...env, POSTGRES_PASSWORD: randomBytes(32).toString('base64url') },
  )
  const descriptor = { id, name, namespace: PERF_DATABASE, run }
  const snapshot = () => {
    inspectOwned(descriptor)
    const counts = JSON.parse(
      docker([
        'exec',
        id,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-Atc',
        `SELECT json_build_object('captured_at',clock_timestamp(),
          'max_connections',current_setting('max_connections')::int,
          'reserved',current_setting('superuser_reserved_connections')::int,
          'groups',(SELECT json_agg(s) FROM
            (SELECT datname,application_name,state,count(*) FROM pg_stat_activity
             GROUP BY datname,application_name,state) s));`,
      ]),
    ) as unknown
    return { ...descriptor, image: IMAGE, publishedOn: `127.0.0.1:${PERF_DATABASE_PORT}`, counts }
  }
  let stopped = false
  const stop = async () => {
    if (stopped) return
    inspectOwned(descriptor)
    docker(['container', 'rm', '--force', descriptor.id])
    stopped = true
  }
  try {
    inspectOwned(descriptor)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const ready = spawnSync(
        'docker',
        ['exec', id, 'pg_isready', '-U', 'postgres', '-d', 'postgres'],
        {
          encoding: 'utf8',
          timeout: 5000,
        },
      )
      if (ready.status === 0) return { stop, descriptor, snapshot }
      // Poll actual readiness; a fixed delay never substitutes for a functional result.
      await new Promise((done) => setTimeout(done, 150))
    }
    throw new Error('Owned performance Postgres did not become ready')
  } catch (error) {
    await stop()
    throw error
  }
}

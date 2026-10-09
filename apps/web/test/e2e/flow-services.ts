import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FLOW_API_PORT,
  FLOW_DB_CONTAINER,
  FLOW_DB_HOST,
  FLOW_DB_NAME,
  FLOW_DB_PORT,
  FLOW_TMP_DIR,
  FLOW_WEB_BASE_URL,
  FLOW_WEB_PORT,
} from './flow-env.js'
import { assertLocalTestDatabase, assertTestPort } from './flow-safety.js'

const VALKEY_IMAGE =
  'valkey/valkey:8-alpine@sha256:cfb2aa4c8352930130fd45eb231a57310ac326d7323edae12b384b9270c46dda'
const CENTRIFUGO_IMAGE =
  'centrifugo/centrifugo:v6@sha256:017d0a3d39757f94a09efa657b6ad7e68222564dd9ba7dd7193981d75cd8a025'

const NAMESPACES = [
  { name: 'dept', presence: false, join_leave: false, history_size: 0 },
  {
    name: 'board',
    presence: true,
    join_leave: true,
    force_push_join_leave: true,
    allow_presence_for_subscriber: true,
  },
  {
    name: 'personal',
    presence: false,
    allow_user_limited_channels: true,
    allow_subscribe_for_client: true,
  },
  {
    name: 'canvas',
    presence: true,
    join_leave: true,
    force_push_join_leave: true,
    allow_presence_for_subscriber: true,
    allow_publish_for_subscriber: true,
  },
]

export const FLOW_SERVICES_FILE = join(FLOW_TMP_DIR, 'services.json')

export type OwnedFlowService = {
  id: string
  name: string
  namespace: string
  run: string
}

export type FlowServiceState = {
  namespace: string
  run: string
  network: OwnedFlowService
  valkey: OwnedFlowService
  centrifugo: OwnedFlowService
  port: number
}

export type FlowServices = {
  env: NodeJS.ProcessEnv
  stop: () => Promise<void>
}

function docker(args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 30_000,
    ...(env ? { env } : {}),
  })
  if (result.status !== 0)
    throw new Error(`Local QA Docker ${args[0]} failed: ${result.stderr?.slice(-1200)}`)
  return result.stdout.trim()
}

/** Test containers may never attach to a remote Docker daemon, even when their port is loopback. */
export function assertLocalDockerEndpoint(endpoint: string): void {
  if (!/^(?:npipe:\/{2,4}\.\/pipe\/|unix:\/\/\/)/.test(endpoint.trim()))
    throw new Error('Local QA services refuse a remote Docker context')
}

function assertActiveLocalDocker(): void {
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  assertLocalDockerEndpoint(
    docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']),
  )
}

/** Both identity and per-run labels must match before any stop/remove operation. */
function assertFlowServiceDescriptor(expected: OwnedFlowService): void {
  if (
    !/^devon_(?:flow_e2e|qa)(?:_[a-z0-9]+)*$/.test(expected.namespace) ||
    expected.namespace.length > 40 ||
    !/^[a-f0-9]{12}$/.test(expected.run) ||
    !/^[a-f0-9]{64}$/.test(expected.id) ||
    !/^[a-z0-9][a-z0-9_.-]+$/.test(expected.name) ||
    !expected.name.startsWith(`flow-${expected.namespace}-${expected.run}-`)
  )
    throw new Error('Unsafe local QA service ownership descriptor')
}

export function assertOwnedFlowService(
  expected: OwnedFlowService,
  actual: { id: string; name: string; labels: Record<string, string> },
): void {
  assertFlowServiceDescriptor(expected)
  if (
    actual.id !== expected.id ||
    actual.name.replace(/^\//, '') !== expected.name ||
    actual.labels['devon.qa.namespace'] !== expected.namespace ||
    actual.labels['devon.qa.run'] !== expected.run
  )
    throw new Error('Refusing to alter a service not owned by this local QA run')
}

function inspectOwnedContainer(expected: OwnedFlowService): void {
  assertFlowServiceDescriptor(expected)
  if (expected.namespace !== FLOW_DB_NAME)
    throw new Error('Refusing to control a container from another local QA namespace')
  assertActiveLocalDocker()
  const value = JSON.parse(
    docker(['container', 'inspect', '--format', '{{json .}}', expected.id]),
  ) as { Id: string; Name: string; Config: { Labels: Record<string, string> } }
  assertOwnedFlowService(expected, {
    id: value.Id,
    name: value.Name,
    labels: value.Config.Labels,
  })
}

export function controlOwnedContainer(
  expected: OwnedFlowService,
  action: 'stop' | 'start' | 'rm',
): void {
  inspectOwnedContainer(expected)
  docker(action === 'rm' ? ['container', 'rm', '--force', expected.id] : [action, expected.id])
}

/** Rotate only the owned broker's HTTP API key, preserving its connection-token key. Browser
 * sockets can reconnect successfully while the real application publisher receives HTTP 401. */
export async function withOwnedPublisherFault(
  state: FlowServiceState,
  journey: () => Promise<void>,
): Promise<void> {
  assertActiveLocalDocker()
  inspectOwnedContainer(state.centrifugo)
  assertFlowServiceDescriptor(state.network)
  const network = JSON.parse(
    docker(['network', 'inspect', '--format', '{{json .}}', state.network.id]),
  ) as { Id: string; Name: string; Labels: Record<string, string> }
  assertOwnedFlowService(state.network, {
    id: network.Id,
    name: network.Name,
    labels: network.Labels,
  })
  if (
    state.namespace !== FLOW_DB_NAME ||
    state.run !== state.centrifugo.run ||
    state.run !== state.network.run
  )
    throw new Error('Publisher fault ownership descriptors must describe this exact QA run')
  assertTestPort(state.port)
  if (state.port !== Number(process.env['FLOW_CENTRIFUGO_PORT'] ?? 48943))
    throw new Error('Publisher fault refuses an unowned broker port')
  const raw = JSON.parse(
    docker(['container', 'inspect', '--format', '{{json .Config.Env}}', state.centrifugo.id]),
  ) as string[]
  const config: NodeJS.ProcessEnv = {}
  for (const entry of raw) {
    const separator = entry.indexOf('=')
    const key = entry.slice(0, separator)
    if (key.startsWith('CENTRIFUGO_')) config[key] = entry.slice(separator + 1)
  }
  const originalApiKey = config['CENTRIFUGO_HTTP_API_KEY']
  if (!originalApiKey || !config['CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY'])
    throw new Error('Owned broker lacks required ephemeral test authentication')
  const recreate = async (apiKey: string) => {
    controlOwnedContainer(state.centrifugo, 'rm')
    const id = docker(
      [
        'run',
        '-d',
        '--pull=never',
        '--name',
        state.centrifugo.name,
        '--label',
        `devon.qa.namespace=${state.namespace}`,
        '--label',
        `devon.qa.run=${state.run}`,
        '--network',
        state.network.name,
        '--publish',
        `127.0.0.1:${state.port}:8000`,
        '--memory',
        '256m',
        '--cpus',
        '1',
        ...Object.keys(config).flatMap((key) => ['--env', key]),
        CENTRIFUGO_IMAGE,
        'centrifugo',
      ],
      { ...process.env, ...config, CENTRIFUGO_HTTP_API_KEY: apiKey },
    )
    state.centrifugo = { ...state.centrifugo, id }
    await writeFile(FLOW_SERVICES_FILE, JSON.stringify(state, null, 2), 'utf8')
    await waitForOwnedCentrifugo(state.port)
  }
  await recreate(randomBytes(32).toString('base64url'))
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': originalApiKey },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    })
    if (response.status !== 401)
      throw new Error(`Real local publisher fault did not reject HTTP auth: ${response.status}`)
    await journey()
  } finally {
    await recreate(originalApiKey)
  }
}

async function waitForValkey(id: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      if (docker(['exec', id, 'valkey-cli', 'ping']) === 'PONG') return
    } catch {
      // A newly-created process may not be listening yet. Readiness, never a blind fixed sleep.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Owned local Valkey did not become ready')
}

export async function waitForOwnedCentrifugo(port: number): Promise<void> {
  assertTestPort(port)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok) return
    } catch {
      // Poll an explicit health condition during initial startup or a deliberate fault recovery.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Owned local Centrifugo did not become ready')
}

/** Real local broker and Valkey, with no shared data/config or configured external endpoints. */
export async function startFlowServices(): Promise<FlowServices> {
  if (process.env['FLOW_REALTIME'] !== '1') return { env: {}, stop: async () => {} }
  assertLocalTestDatabase({
    host: FLOW_DB_HOST,
    database: FLOW_DB_NAME,
    container: FLOW_DB_CONTAINER,
    port: FLOW_DB_PORT,
  })
  assertActiveLocalDocker()
  const port = Number(process.env['FLOW_CENTRIFUGO_PORT'] ?? 48943)
  assertTestPort(port)
  if ([FLOW_API_PORT, FLOW_WEB_PORT, FLOW_DB_PORT].includes(port))
    throw new Error('Local realtime port must differ from the API, web and database ports')
  // --pull=never below makes cached, digest-pinned images an explicit prerequisite.
  docker(['image', 'inspect', '--format', '{{.Id}}', VALKEY_IMAGE])
  docker(['image', 'inspect', '--format', '{{.Id}}', CENTRIFUGO_IMAGE])
  const run = randomBytes(6).toString('hex')
  const prefix = `flow-${FLOW_DB_NAME}-${run}`
  const labels = ['--label', `devon.qa.namespace=${FLOW_DB_NAME}`, '--label', `devon.qa.run=${run}`]
  const owned = (id: string, name: string): OwnedFlowService => ({
    id,
    name,
    namespace: FLOW_DB_NAME,
    run,
  })
  let network: OwnedFlowService | null = null
  let valkey: OwnedFlowService | null = null
  let centrifugo: OwnedFlowService | null = null
  const stop = async () => {
    // Immutable ids + matching run labels, not name wildcards, protect unrelated local services.
    const errors: unknown[] = []
    // A deliberate HTTP-key fault can recreate this run's broker under the same name. Adopt its
    // latest immutable id only after the stored descriptor still matches our namespace/run/name.
    try {
      const { readFile } = await import('node:fs/promises')
      const current = JSON.parse(await readFile(FLOW_SERVICES_FILE, 'utf8')) as FlowServiceState
      if (
        centrifugo &&
        current.namespace === FLOW_DB_NAME &&
        current.run === run &&
        current.centrifugo.name === centrifugo.name
      )
        centrifugo = current.centrifugo
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(error)
    }
    for (const service of [centrifugo, valkey]) {
      if (!service) continue
      try {
        controlOwnedContainer(service, 'rm')
      } catch (error) {
        errors.push(error)
      }
    }
    if (network) {
      try {
        const actual = JSON.parse(
          docker(['network', 'inspect', '--format', '{{json .}}', network.id]),
        ) as { Id: string; Name: string; Labels: Record<string, string> }
        assertOwnedFlowService(network, { id: actual.Id, name: actual.Name, labels: actual.Labels })
        docker(['network', 'rm', network.id])
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Owned local QA services cleanup failed')
    await rm(FLOW_SERVICES_FILE, { force: true })
  }
  try {
    const networkName = `${prefix}-network`
    network = owned(
      // Docker Desktop suppresses published ports on --internal networks. An isolated bridge
      // exposes only the broker's explicitly loopback-bound port; Valkey has no host port.
      docker(['network', 'create', ...labels, networkName]),
      networkName,
    )
    const valkeyName = `${prefix}-valkey`
    valkey = owned(
      docker([
        'run',
        '-d',
        '--pull=never',
        '--name',
        valkeyName,
        ...labels,
        '--network',
        networkName,
        '--network-alias',
        'valkey',
        '--memory',
        '128m',
        '--cpus',
        '0.5',
        VALKEY_IMAGE,
        'valkey-server',
        '--save',
        '',
        '--appendonly',
        'no',
      ]),
      valkeyName,
    )
    await waitForValkey(valkey.id)
    const apiKey = randomBytes(32).toString('base64url')
    const tokenKey = randomBytes(32).toString('base64url')
    const brokerConfig: NodeJS.ProcessEnv = {
      CENTRIFUGO_HTTP_SERVER_ADDRESS: '0.0.0.0',
      CENTRIFUGO_HTTP_API_INSECURE: 'false',
      CENTRIFUGO_HEALTH_ENABLED: 'true',
      CENTRIFUGO_HTTP_API_KEY: apiKey,
      CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: tokenKey,
      CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: FLOW_WEB_BASE_URL,
      CENTRIFUGO_CLIENT_ALLOW_ANONYMOUS_CONNECT_WITHOUT_TOKEN: 'false',
      CENTRIFUGO_ENGINE_TYPE: 'redis',
      CENTRIFUGO_ENGINE_REDIS_ADDRESS: 'redis://valkey:6379',
      CENTRIFUGO_ENGINE_REDIS_PREFIX: prefix,
      CENTRIFUGO_CHANNEL_NAMESPACES: JSON.stringify(NAMESPACES),
    }
    const centrifugoName = `${prefix}-centrifugo`
    centrifugo = owned(
      docker(
        [
          'run',
          '-d',
          '--pull=never',
          '--name',
          centrifugoName,
          ...labels,
          '--network',
          networkName,
          '--publish',
          `127.0.0.1:${port}:8000`,
          '--memory',
          '256m',
          '--cpus',
          '1',
          ...Object.keys(brokerConfig).flatMap((key) => ['--env', key]),
          CENTRIFUGO_IMAGE,
          'centrifugo',
        ],
        { ...process.env, ...brokerConfig },
      ),
      centrifugoName,
    )
    await waitForOwnedCentrifugo(port)
    await mkdir(FLOW_TMP_DIR, { recursive: true })
    const state: FlowServiceState = {
      namespace: FLOW_DB_NAME,
      run,
      network,
      valkey,
      centrifugo,
      port,
    }
    // This file contains ownership evidence only. Signing/API keys remain in memory and Docker env.
    await writeFile(FLOW_SERVICES_FILE, JSON.stringify(state, null, 2), 'utf8')
    return {
      env: {
        CENTRIFUGO_WS_URL: `ws://127.0.0.1:${port}/connection/websocket`,
        CENTRIFUGO_API_URL: `http://127.0.0.1:${port}`,
        CENTRIFUGO_API_KEY: apiKey,
        CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: tokenKey,
        CENTRIFUGO_TIMEOUT_MS: '1000',
      },
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}

import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import {
  FLOW_API_PORT,
  FLOW_DB_NAME,
  FLOW_DB_PORT,
  FLOW_TMP_DIR,
  FLOW_WEB_PORT,
} from './flow-env.js'
import {
  assertLocalDockerEndpoint,
  controlOwnedContainer,
  type OwnedFlowService,
} from './flow-services.js'
import { assertTestPort } from './flow-safety.js'

export const FLOW_SCANNER_IMAGE =
  'clamav/clamav:1.4@sha256:b25d9199257ae7ef45e0cc4c7eaa60ce7e5447796f0090d5ff311d1a30980cc3'
export const FLOW_SCANNER_FILE = join(FLOW_TMP_DIR, 'scanner.json')
export type FlowScannerState = { container: OwnedFlowService; port: number; image: string }
type FlowScanner = { env: NodeJS.ProcessEnv; port?: number; stop: () => Promise<void> }

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 })
  if (result.error || result.status !== 0)
    throw new Error(`Owned QA scanner ${args[0]} failed: ${result.stderr?.slice(-800)}`)
  return result.stdout.trim()
}

export function assertScannerPort(port: number, reserved: readonly number[]): void {
  assertTestPort(port)
  if (reserved.includes(port))
    throw new Error('Owned QA scanner port collides with another service')
}

/** Real clamd PING, not a readiness fixture or a simulated scanner response. */
export function pingFlowScanner(port: number): Promise<boolean> {
  assertTestPort(port)
  return new Promise((resolve) => {
    let settled = false
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ready)
    }
    const timer = setTimeout(() => finish(false), 1000)
    let reply = ''
    socket.on('connect', () => socket.write('zPING\0'))
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8')
      if (reply.includes('\0')) finish(reply === 'PONG\0')
    })
    socket.on('error', () => finish(false))
    socket.on('close', () => finish(false))
  })
}

export async function waitForFlowScanner(port: number): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await pingFlowScanner(port)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Owned QA clamd did not answer PING within 90 seconds')
}

/** Opt-in actual scanning. No shared volumes, updates, credentials, or production daemon. */
export async function startFlowScanner(brokerPort?: number): Promise<FlowScanner> {
  if (process.env['FLOW_CLAMAV'] !== '1') return { env: {}, stop: async () => {} }
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  assertLocalDockerEndpoint(
    docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']),
  )
  const port = Number(process.env['FLOW_CLAMAV_PORT'] ?? 49003)
  assertScannerPort(port, [
    FLOW_API_PORT,
    FLOW_WEB_PORT,
    FLOW_DB_PORT,
    ...(brokerPort ? [brokerPort] : []),
  ])
  const image = docker(['image', 'inspect', '--format', '{{.Id}}', FLOW_SCANNER_IMAGE])
  const run = randomBytes(6).toString('hex')
  const name = `flow-${FLOW_DB_NAME}-${run}-clamav`
  let container: OwnedFlowService | undefined
  const stop = async () => {
    if (container) controlOwnedContainer(container, 'rm')
    await rm(FLOW_SCANNER_FILE, { force: true })
  }
  try {
    const id = docker([
      'run',
      '-d',
      '--pull=never',
      '--name',
      name,
      '--label',
      `devon.qa.namespace=${FLOW_DB_NAME}`,
      '--label',
      `devon.qa.run=${run}`,
      '--publish',
      `127.0.0.1:${port}:3310`,
      '--memory',
      '2g',
      '--cpus',
      '1',
      '--env',
      'CLAMAV_NO_FRESHCLAMD=true',
      '--env',
      'CLAMAV_NO_MILTERD=true',
      '--env',
      'CLAMD_STARTUP_TIMEOUT=90',
      FLOW_SCANNER_IMAGE,
    ])
    container = { id, name, namespace: FLOW_DB_NAME, run }
    await waitForFlowScanner(port)
    await mkdir(FLOW_TMP_DIR, { recursive: true })
    await writeFile(
      FLOW_SCANNER_FILE,
      JSON.stringify({ container, port, image } satisfies FlowScannerState),
      'utf8',
    )
    return {
      env: {
        CLAMAV_MODE: 'clamd',
        CLAMAV_HOST: '127.0.0.1',
        CLAMAV_PORT: String(port),
        CLAMAV_TIMEOUT_MS: '3000',
      },
      port,
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}

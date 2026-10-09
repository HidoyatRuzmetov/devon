import { isAbsolute, relative, resolve } from 'node:path'
import { lstatSync } from 'node:fs'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function assertLocalTestDatabase(input: {
  host: string
  database: string
  container: string
  port: number
}): void {
  if (!LOOPBACK.has(input.host.toLowerCase())) {
    throw new Error('Destructive browser tests require a literal loopback database host')
  }
  if (!/^devon_(?:flow_e2e|qa)(?:_[a-z0-9]+)*$/.test(input.database)) {
    throw new Error(
      'Destructive browser tests require an explicitly named devon_flow_e2e/qa database',
    )
  }
  if (input.database.length > 40 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(input.container)) {
    throw new Error('Unsafe browser test database/container identifier')
  }
  assertTestPort(input.port)
}

export function assertTestPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Browser test ports must be integers between 1024 and 65535')
  }
}

export function assertLocalTestUrl(value: string): void {
  const url = new URL(value)
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new Error('Browser tests refuse nonlocal endpoints')
  }
}

/** Inherited credentials must never turn an isolated test into a live integration client. */
export function localFlowEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  storageDirectory: string,
): NodeJS.ProcessEnv {
  const withinScratch = relative(resolve(import.meta.dirname, '.tmp'), resolve(storageDirectory))
  if (
    !isAbsolute(storageDirectory) ||
    !/^devon_(?:flow_e2e|qa)(?:_[a-z0-9]+)*[\\/]storage$/.test(withinScratch)
  ) {
    throw new Error('Browser test storage must use its own absolute flow_e2e scratch directory')
  }
  const namespace = withinScratch.split(/[\\/]/)[0]!
  for (const path of [
    resolve(import.meta.dirname, '.tmp'),
    resolve(import.meta.dirname, '.tmp', namespace),
    resolve(storageDirectory),
  ]) {
    try {
      if (lstatSync(path).isSymbolicLink())
        throw new Error('Browser test storage refuses symlinks or directory junctions')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const env = { ...inherited }
  for (const key of Object.keys(env)) {
    if (
      /^(AI_|GLM_|TELEGRAM_|SMTP_|MAIL_|STORAGE_|CENTRIFUGO_|VAPID_)/.test(key) ||
      key === 'DEVON_SENTINEL_URL' ||
      key === 'NODE_OPTIONS'
    )
      delete env[key]
  }
  return {
    ...env,
    ...overrides,
    // Keep real API workers and simultaneous browser namespaces within the shared local
    // Postgres budget. An inherited production-sized pool must not exhaust other QA slices.
    DB_POOL_MAX: '6',
    DB_POOL_MIN: '1',
    QUEUE_DB_POOL_MAX: '2',
    AI_API_KEY: '',
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_BOT_USERNAME: undefined,
    TELEGRAM_POLLING_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storageDirectory,
    CLAMAV_MODE: 'off',
    // A local development scanner exception, never a production setting.
    DEVON_SETUP_REMOTE: 'false',
    DEVON_METRICS_REMOTE: 'false',
  }
}

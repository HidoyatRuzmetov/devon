// Shared test bootstrap: a real `buildApp()` wired to the in-memory fake `Deps`, so route/permission
// tests exercise the actual Fastify wiring (onRoute boot guard, authorize preHandler, cookie
// attributes) without ever touching Postgres.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp, type BuildAppOptions } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import { createFakeDeps, createFakeState, type FakeState } from './fake-deps.js'

/** One temp directory per test process for the storage plugin's local driver -- objects an avatar
 * test writes never land inside the repo, and never collide across parallel vitest workers. */
const STORAGE_TMP_DIR = mkdtempSync(join(tmpdir(), 'devon-storage-test-'))

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    TELEGRAM_POLLING_ENABLED: false,
    TELEGRAM_TRANSPORT: 'webhook',
    API_PORT: 0,
    DEVON_PUBLIC_URL: 'http://localhost:5173',
    DEVON_ALLOWED_ORIGINS: '',
    DATABASE_URL: 'postgres://example:example@127.0.0.1:5432/example', // example, unused (fake deps)
    SESSION_COOKIE_NAME: 'devon_sid',
    SESSION_IDLE_MINUTES: 720,
    SESSION_ABSOLUTE_DAYS: 30,
    CSRF_SECRET: 'test-csrf-secret-example-value',
    // `false` matches the production default: `app.inject()` simulates a `127.0.0.1` peer unless a
    // test explicitly passes `remoteAddress`, so the loopback gate is exercised for real (not bypassed).
    DEVON_SETUP_REMOTE: false,
    LOG_LEVEL: 'silent',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: STORAGE_TMP_DIR,
    STORAGE_S3_REGION: 'us-east-1',
    STORAGE_S3_BUCKET: 'devon',
    STORAGE_S3_FORCE_PATH_STYLE: true,
    STORAGE_MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
    STORAGE_TIMEOUT_MS: 10_000,
    // Unit tests never run a clamd; the infected path is exercised through `BuildAppOptions.storage`
    // (a fake scanner), see `test/unit/accounts/avatar.test.ts`.
    CLAMAV_MODE: 'off',
    CLAMAV_HOST: '127.0.0.1',
    CLAMAV_PORT: 3310,
    CLAMAV_TIMEOUT_MS: 20_000,
    SLOW_REQUEST_MS: 1000,
    DEVON_METRICS_REMOTE: false,
    HTTP_BODY_LIMIT_BYTES: 1 * 1024 * 1024,
    JSON_MAX_DEPTH: 16,
    AI_MAX_INPUT_BYTES: 32 * 1024,
    // H1.14: the module runs in its documented no-op mode with no bot token (transport.ts).
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_BOT_USERNAME: undefined,
    TELEGRAM_WEBHOOK_SECRET: undefined,
    ...overrides,
  }
}

export async function buildTestApp(
  state: FakeState = createFakeState(),
  options: BuildAppOptions & { config?: Partial<Config> } = {},
) {
  const { config: configOverrides, ...buildOptions } = options
  const config = testConfig(configOverrides)
  const deps = createFakeDeps(state)
  const app = await buildApp(deps, config, buildOptions)
  await app.ready()
  return { app, deps, state, config }
}

/** Parses `set-cookie` response headers into `{ name: value }`, ignoring attributes. */
export function parseSetCookies(setCookie: string | string[] | undefined): Record<string, string> {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  const out: Record<string, string> = {}
  for (const line of list) {
    const [pair] = line.split(';')
    const eq = pair?.indexOf('=') ?? -1
    if (pair && eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// Shared test bootstrap: a real `buildApp()` wired to the in-memory fake `Deps`, so route/permission
// tests exercise the actual Fastify wiring (onRoute boot guard, authorize preHandler, cookie
// attributes) without ever touching Postgres.
import { buildApp } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import { createFakeDeps, createFakeState, type FakeState } from './fake-deps.js'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    API_PORT: 0,
    DEVON_PUBLIC_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgres://example:example@127.0.0.1:5432/example', // example, unused (fake deps)
    SESSION_COOKIE_NAME: 'devon_sid',
    SESSION_IDLE_MINUTES: 720,
    SESSION_ABSOLUTE_DAYS: 30,
    CSRF_SECRET: 'test-csrf-secret-example-value',
    // `false` matches the production default: `app.inject()` simulates a `127.0.0.1` peer unless a
    // test explicitly passes `remoteAddress`, so the loopback gate is exercised for real (not bypassed).
    DEVON_SETUP_REMOTE: false,
    LOG_LEVEL: 'silent',
    ...overrides,
  }
}

export async function buildTestApp(state: FakeState = createFakeState()) {
  const config = testConfig()
  const deps = createFakeDeps(state)
  const app = await buildApp(deps, config)
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

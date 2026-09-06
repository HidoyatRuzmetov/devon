// Playwright `globalSetup` (see `playwright.config.ts`). Brings up as much of the real stack as it
// can and tells the tests, via `process.env`, what actually came up -- every spec in `tests/` reads
// `E2E_BACKEND_READY`/`E2E_SUPERADMIN_STATE` (see `fixtures.ts`) and skips (never silently "passes")
// the assertions it cannot honestly make, rather than the whole run failing because one dependency
// wasn't there. `process.env` mutations made here are visible to every worker process Playwright
// spawns afterwards, because they all fork from this same process.
//
// Steps, each best-effort and independently loggable (`process-utils.ts`'s `runToCompletion` /
// `spawnManaged` never throw on failure):
//   1. `apps/web` dev server -- every route needs this; if it does not come up, the whole run aborts
//      (Playwright's own `webServer` config would have aborted here too; this is the one hard
//      dependency).
//   2. Postgres + Valkey via `infra/docker-compose.yml`, then `@devon/db`'s migration-apply step.
//      Skippable with `E2E_SKIP_BACKEND=1`.
//   3. `apps/api` dev server, once (2) succeeded.
//   4. A `super_admin` session (`lib/backend.ts`), once (3) is reachable -- written to
//      `.tmp/superadmin-storage-state.json` for `fixtures.ts`'s `superAdminPage` fixture.
//   5. Optionally Storybook (`packages/ui`), for spec.md §12.F's glyph/formatting shots.
//      Skippable with `E2E_SKIP_STORYBOOK=1`.
//
// Returns a teardown function (Playwright's documented pattern for the same file to own both halves)
// that stops every process this function started, in reverse order.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FullConfig } from '@playwright/test'
import {
  API_BASE_URL,
  API_PORT,
  REPO_ROOT,
  SKIP_BACKEND,
  SKIP_STORYBOOK,
  STORYBOOK_BASE_URL,
  STORYBOOK_PORT,
  TMP_DIR,
  WEB_BASE_URL,
  WEB_PORT,
} from './lib/env.js'
import {
  runToCompletion,
  spawnManaged,
  waitForHttp,
  type ManagedProcess,
} from './lib/process-utils.js'
import { cookiesToStorageState, ensureSuperAdminSession } from './lib/backend.js'
import { finalizeManifest } from './lib/manifest.js'

async function bringUpBackend(): Promise<ManagedProcess | null> {
  console.log('[global-setup] starting Postgres + Valkey (docker compose up -d postgres valkey)')
  const compose = runToCompletion('docker', 'docker', [
    'compose',
    '-f',
    join(REPO_ROOT, 'infra', 'docker-compose.yml'),
    'up',
    '-d',
    'postgres',
    'valkey',
  ])
  if (!compose.ok) {
    console.log(
      '[global-setup] docker compose did not succeed -- is Docker running? Backend-dependent tests will skip.',
    )
    return null
  }

  console.log('[global-setup] applying database migrations (@devon/db migrate:apply)')
  const migrate = runToCompletion('migrate', 'pnpm', ['--filter', '@devon/db', 'migrate:apply'])
  if (!migrate.ok) {
    console.log(
      '[global-setup] `@devon/db migrate:apply` did not succeed (script may not exist yet -- ' +
        'EPIC-000.demo/W2 land it separately). Backend-dependent tests will skip.',
    )
    return null
  }

  const api = spawnManaged('api', 'pnpm', ['--filter', '@devon/api', 'dev'], {
    env: { ...process.env, API_PORT: String(API_PORT) },
  })
  const apiUp = await waitForHttp(`${API_BASE_URL}/healthz`, 60_000)
  if (!apiUp) {
    console.log(
      '[global-setup] apps/api did not answer /healthz within 60s -- stopping it, tests will skip.',
    )
    await api.stop()
    return null
  }
  console.log('[global-setup] apps/api is up.')
  return api
}

async function bringUpStorybook(): Promise<ManagedProcess | null> {
  const storybook = spawnManaged('storybook', 'pnpm', [
    '--filter',
    '@devon/ui',
    'exec',
    'storybook',
    'dev',
    '-p',
    String(STORYBOOK_PORT),
    '--ci',
    '--quiet',
  ])
  const up = await waitForHttp(STORYBOOK_BASE_URL, 90_000)
  if (!up) {
    console.log(
      '[global-setup] Storybook did not come up within 90s -- storybook shots (spec.md §12.F) will skip.',
    )
    await storybook.stop()
    return null
  }
  console.log('[global-setup] Storybook is up.')
  return storybook
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  await mkdir(TMP_DIR, { recursive: true })
  const started: ManagedProcess[] = []

  // 1. apps/web -- the one hard dependency. Playwright still retries the whole `globalSetup` zero
  // times, so a clear failure here is preferable to a confusing 60-second timeout inside every test.
  // `DEVON_E2E=1` is what compiles the `?__state=` forcing branch into the bundle at all
  // (`apps/web/src/lib/forced-state.ts`) -- every one of this item's state-forcing/screenshot specs
  // needs the dev server started with this set, not just the browser navigated with a query param.
  const web = spawnManaged('web', 'pnpm', ['--filter', '@devon/web', 'dev'], {
    env: { ...process.env, WEB_PORT: String(WEB_PORT), DEVON_E2E: '1' },
  })
  started.push(web)
  const webUp = await waitForHttp(WEB_BASE_URL, 60_000)
  if (!webUp) {
    for (const p of started) await p.stop()
    throw new Error(
      `[global-setup] apps/web did not answer at ${WEB_BASE_URL} within 60s -- see the [web] log lines above.`,
    )
  }
  console.log('[global-setup] apps/web is up.')

  // 2 + 3. Postgres/Valkey + apps/api, best-effort.
  let backendReady = false
  if (SKIP_BACKEND) {
    console.log('[global-setup] E2E_SKIP_BACKEND=1 -- not attempting Postgres/Valkey/apps/api.')
  } else {
    const api = await bringUpBackend()
    if (api) {
      started.push(api)
      backendReady = true

      // 4. super_admin session, cached to disk for `fixtures.ts`.
      const session = await ensureSuperAdminSession(api.output)
      if (session) {
        // `domain: '127.0.0.1'` (host-only, no leading dot) matches the browser's own address bar --
        // `apps/web`'s dev server proxies `/api/*` same-origin (`src/vite.config.ts`), so a cookie
        // scoped to the web origin is exactly what a real signed-in browser session would hold too.
        const state = { cookies: cookiesToStorageState(session.cookies, '127.0.0.1'), origins: [] }
        await writeFile(
          join(TMP_DIR, 'superadmin-storage-state.json'),
          JSON.stringify(state, null, 2),
          'utf8',
        )
        console.log(
          `[global-setup] super_admin session ready (login: ${session.credentials.login}).`,
        )
      } else {
        console.log(
          '[global-setup] could not obtain a super_admin session -- super_admin-only assertions will skip.',
        )
      }
    }
  }
  process.env['E2E_BACKEND_READY'] = backendReady ? '1' : '0'

  // 5. Storybook, best-effort, independent of the backend.
  let storybookReady = false
  if (SKIP_STORYBOOK) {
    console.log('[global-setup] E2E_SKIP_STORYBOOK=1 -- not attempting Storybook.')
  } else {
    const storybook = await bringUpStorybook()
    if (storybook) {
      started.push(storybook)
      storybookReady = true
    }
  }
  process.env['E2E_STORYBOOK_READY'] = storybookReady ? '1' : '0'

  return async function globalTeardown(): Promise<void> {
    const manifest = await finalizeManifest()
    console.log(
      manifest
        ? `[global-setup] qa-visual manifest.json written: ${manifest.routes.length} route(s), states_verified=${manifest.statesVerified}.`
        : '[global-setup] no screenshots were recorded -- manifest.json not written.',
    )
    for (const p of [...started].reverse()) {
      console.log(`[global-setup] stopping ${p.label} ...`)
      await p.stop()
    }
  }
}

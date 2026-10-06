// Playwright `globalSetup` for the `@flow` suite (HARDENING.md H30.1: the six end-to-end flows).
// `shell.smoke.spec.ts`'s own header already flagged that most specs need `apps/api` running too and
// left orchestrating that to whichever item's TOUCHES covers it -- this is that: a dedicated database
// (`flow-db.ts`), a real `apps/api dev` process pointed at it (`flow-process.ts`), and a one-time
// `super_admin` bootstrap (needed by the `admin-pause` flow) via the real `POST /setup/{token}`
// contract, exactly like `e2e/lib/backend.ts` does for the root suite -- reimplemented here, not
// imported, because `e2e/` manages its own dependencies outside the pnpm workspace (see
// `flow-process.ts`'s header) and `apps/web` must not reach into another package's `node_modules`.
//
// `apps/web`'s own dev server is still `playwright.config.ts`'s `webServer` (Playwright's documented
// place for the one process every spec needs); this only brings up the second one.
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { bootstrapFlowDatabase } from './flow-db.js'
import { spawnManaged, waitForHttp, type ManagedProcess } from './flow-process.js'
import {
  FLOW_API_BASE_URL,
  FLOW_API_LOG_FILE,
  FLOW_API_PORT,
  FLOW_SUPERADMIN_FILE,
  FLOW_TMP_DIR,
  FLOW_WEB_BASE_URL,
  type FlowSuperAdmin,
} from './flow-env.js'

// `apps/web/test/e2e/global-setup.ts` -> repo root is four `..` up (same as `flow-db.ts`).
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

function extractSetupToken(lines: readonly string[]): string | null {
  for (const line of lines) {
    const m = /\/setup\?token=([^&\s"]+)/.exec(line)
    if (m?.[1]) return decodeURIComponent(m[1])
  }
  return null
}

let apiProcess: ManagedProcess | null = null

export default async function globalSetup(): Promise<() => Promise<void>> {
  await mkdir(FLOW_TMP_DIR, { recursive: true })
  await writeFile(FLOW_API_LOG_FILE, '', 'utf8').catch(() => {})

  console.log('[flow global-setup] bootstrapping a dedicated database (devon_flow_e2e)')
  const db = bootstrapFlowDatabase()

  console.log(
    `[flow global-setup] starting apps/api on ${FLOW_API_BASE_URL} (log: ${FLOW_API_LOG_FILE})`,
  )
  // Test servers must not restart halfway through requests when another local edit is saved.
  apiProcess = spawnManaged('pnpm', ['--filter', '@devon/api', 'exec', 'tsx', 'src/server.ts'], {
    cwd: REPO_ROOT,
    logFile: FLOW_API_LOG_FILE,
    env: {
      ...process.env,
      API_PORT: String(FLOW_API_PORT),
      DATABASE_URL: db.appUrl,
      CSRF_SECRET: randomBytes(24).toString('base64url'),
      DEVON_PUBLIC_URL: FLOW_WEB_BASE_URL,
      NODE_ENV: 'development',
    },
  })

  try {
    const up = await waitForHttp(`${FLOW_API_BASE_URL}/healthz`, 90_000)
    if (!up) {
      console.log('[flow global-setup] apps/api did not answer /healthz within 90s; recent output:')
      console.log(apiProcess.lines.slice(-40).join('\n'))
      throw new Error('flow suite: apps/api never became healthy')
    }
    console.log('[flow global-setup] apps/api is up.')

    const token = extractSetupToken(apiProcess.lines)
    if (token) {
      const superAdmin: FlowSuperAdmin = {
        login: 'flow.superadmin',
        password: `FlowE2e-${randomBytes(9).toString('base64url')}Aa1`,
      }
      const res = await fetch(`${FLOW_API_BASE_URL}/api/v1/setup/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login: superAdmin.login,
          password: superAdmin.password,
          givenName: 'Nodira',
          familyName: 'Islomova',
        }),
      })
      if (res.status !== 201) {
        throw new Error(
          `flow suite: consuming the setup token failed: ${res.status} ${await res.text()}`,
        )
      }
      await writeFile(FLOW_SUPERADMIN_FILE, JSON.stringify(superAdmin, null, 2), 'utf8')
      console.log('[flow global-setup] super_admin bootstrapped for the admin-pause flow.')
    } else {
      throw new Error('flow suite: fresh database did not produce a setup token')
    }
  } catch (error) {
    // Playwright cannot call a teardown that globalSetup never returned. Stop our own child on
    // startup/bootstrap failure, too, so retries cannot attach to a stale API/database connection.
    await apiProcess.stop()
    throw error
  }

  return async function globalTeardown() {
    await apiProcess?.stop()
  }
}

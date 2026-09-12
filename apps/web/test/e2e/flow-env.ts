// Shared constants for the H30.1 `@flow` suite (`global-setup.ts` + every `*.flow.spec.ts`). Fixed,
// dedicated ports -- deliberately never the plain `WEB_PORT`/`API_PORT` defaults `playwright.config.ts`
// otherwise falls back to (3000/5173): this suite brings up its *own* apps/api against its *own*
// database, and a developer or another hardening worktree very plausibly already has a real `pnpm
// start` sitting on the default ports -- reusing those would silently attach this suite's assertions
// to a foreign server. Override with `FLOW_API_PORT`/`FLOW_WEB_PORT` if these ever collide.
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E_DIR = dirname(fileURLToPath(import.meta.url))
export const FLOW_TMP_DIR = join(E2E_DIR, '.tmp')

export const FLOW_API_PORT = Number(process.env['FLOW_API_PORT'] ?? 48901)
export const FLOW_WEB_PORT = Number(process.env['FLOW_WEB_PORT'] ?? 48902)
export const FLOW_API_BASE_URL = `http://127.0.0.1:${FLOW_API_PORT}`
export const FLOW_WEB_BASE_URL = `http://127.0.0.1:${FLOW_WEB_PORT}`

/** The dedicated database this suite bootstraps itself, inside the same shared `devon-postgres`
 * container `pnpm start` uses (see `global-setup.ts`) -- never the `devon` database a developer's own
 * `pnpm start --demo` is using, and never a Testcontainers-throwaway one (this suite needs the *dev*
 * `apps/api`/`apps/web` processes actually running and reachable over HTTP, which Testcontainers'
 * ephemeral-port model does not fit as naturally as `packages/db/test/harness.ts`'s Vitest suites do). */
export const FLOW_DB_NAME = process.env['FLOW_DB_NAME'] ?? 'devon_flow_e2e'
export const FLOW_DB_HOST = process.env['FLOW_DB_HOST'] ?? '127.0.0.1'
export const FLOW_DB_PORT = Number(process.env['FLOW_DB_PORT'] ?? 55432)
export const FLOW_DB_CONTAINER = process.env['FLOW_DB_CONTAINER'] ?? 'devon-postgres'

/** Suffixed so this suite's own migration run never touches the cluster-wide `devon_app`/
 * `devon_migrator` login roles a concurrently-running `pnpm start` elsewhere depends on (Postgres
 * roles are cluster-global, not per-database -- resetting the plain-named roles' passwords here would
 * silently break every other database's connections on the same shared container). */
export const FLOW_APP_ROLE = 'devon_app_flowe2e'
export const FLOW_MIGRATOR_ROLE = 'devon_migrator_flowe2e'

export const FLOW_SUPERADMIN_FILE = join(FLOW_TMP_DIR, 'superadmin.json')
/** `apps/api dev`'s full stdout/stderr for this run, refreshed at the start of every `globalSetup` --
 * where a flow's server-side 500 stack trace lives, since the client only ever sees the sanitised
 * Problem body (`lib/problem-reply.ts`). Not evidence, not committed: `.gitignore`d scratch, same as
 * everything else under `FLOW_TMP_DIR`. */
export const FLOW_API_LOG_FILE = join(FLOW_TMP_DIR, 'api.log')

export type FlowSuperAdmin = { login: string; password: string }

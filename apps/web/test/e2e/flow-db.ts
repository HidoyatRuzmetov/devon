// Bootstraps a fresh, dedicated application database for the `@flow` suite, inside the same shared
// `devon-postgres` container `pnpm start` already uses -- no Testcontainers here (this suite needs a
// long-lived, reachable-over-TCP database for a real `apps/api dev` process to sit in front of, not a
// throwaway per-test instance). Talks to Postgres two ways, deliberately:
//   - schema/role DDL runs *inside* the container (`docker exec -i ... psql`), which authenticates the
//     `postgres` superuser via the image's local trust auth -- no password ever needed, so nothing here
//     is a secret the repo's `check-secrets.mjs` gate could mistake for a leaked credential.
//   - the connection string handed to `apps/api` (`DATABASE_URL`) is a real TCP connection with a
//     freshly-generated, in-memory-only password (`node:crypto`, never written to disk) -- Postgres
//     does enforce password auth over TCP even though the local socket trusts the `postgres` user.
// Suffixed role names (`flow-env.ts`'s `FLOW_APP_ROLE`/`FLOW_MIGRATOR_ROLE`) so this never resets the
// plain `devon_app`/`devon_migrator` roles' cluster-wide password out from under a concurrently
// running `pnpm start` elsewhere on the same shared container.
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  FLOW_APP_ROLE,
  FLOW_DB_CONTAINER,
  FLOW_DB_HOST,
  FLOW_DB_NAME,
  FLOW_DB_PORT,
  FLOW_MIGRATOR_ROLE,
} from './flow-env.js'

// `apps/web/test/e2e/flow-db.ts` -> repo root is four `..` up.
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'db', 'migrations')

function runPsqlInContainer(sql: string, database: string): void {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      FLOW_DB_CONTAINER,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database,
    ],
    { input: sql, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(
      `[flow-db] psql against ${database} failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
    )
  }
}

function substituteAndRename(sql: string, vars: Record<string, string>): string {
  const withVars = sql.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => {
    if (vars[name] === undefined) throw new Error(`migration references unresolved \${${name}}`)
    return vars[name]
  })
  // Word-boundary replace: every migration file references the two role names only as the bare
  // identifiers `devon_migrator`/`devon_app` (verified against every file in this migrations
  // directory before writing this suite) -- never as a substring of a longer identifier -- so a plain
  // global replace is exact, not a heuristic.
  return withVars
    .replace(/\bdevon_migrator\b/g, FLOW_MIGRATOR_ROLE)
    .replace(/\bdevon_app\b/g, FLOW_APP_ROLE)
}

export type FlowDatabase = { appUrl: string }

/** Drops and recreates `FLOW_DB_NAME`, applies every migration fresh, and returns a TCP connection
 * string for the suite's own dedicated app role. Idempotent across repeated `npx playwright test`
 * invocations on the same machine -- always starts from a clean slate, so `@flow` specs never inherit
 * state from a previous run. */
export function bootstrapFlowDatabase(): FlowDatabase {
  runPsqlInContainer(
    `drop database if exists ${FLOW_DB_NAME};\ncreate database ${FLOW_DB_NAME};`,
    'postgres',
  )

  const migratorPassword = randomBytes(24).toString('base64url')
  const appPassword = randomBytes(24).toString('base64url')

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    const sql = substituteAndRename(raw, {
      POSTGRES_MIGRATOR_PASSWORD: migratorPassword,
      POSTGRES_APP_PASSWORD: appPassword,
    })
    runPsqlInContainer(sql, FLOW_DB_NAME)
  }

  const appUrl = `postgres://${FLOW_APP_ROLE}:${encodeURIComponent(appPassword)}@${FLOW_DB_HOST}:${FLOW_DB_PORT}/${FLOW_DB_NAME}`
  return { appUrl }
}

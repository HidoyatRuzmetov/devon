// The real migrator: applies `packages/db/migrations/*.sql` to a live, persistent Postgres (the
// counterpart to `test/harness.ts`, which applies the same files to a throwaway Testcontainers
// instance for `migrate:verify`). `scripts/start.mjs` runs this via `pnpm --filter @devon/db
// migrate:apply` on every `pnpm start` -- see MODULE-GUIDE.md "Migrations".
//
// Idempotent and journal-free by design (TECH-SPEC item handoff): no drizzle-kit `meta/_journal.json`
// anywhere -- the single source of truth for "which migrations has this database already seen" is the
// `app._migrations` table this file creates and maintains. Filename order is the only ordering rule
// (the reserved numeric prefixes in MODULE-GUIDE.md keep that order meaningful across modules); a
// second `migrate:apply` run against an already-migrated database applies zero files and exits 0.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

export type MigrationFile = { name: string; sql: string }

export function readMigrationFiles(dir: string = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

/** Replaces every `${VAR_NAME}` token with `vars[VAR_NAME]`, same as `test/harness.ts`'s helper of the
 * same name -- kept as a separate copy (not imported from `test/**`) because production code must
 * never depend on the `test/` tree. Throws on an unresolved token so a typo fails loudly at apply
 * time rather than shipping a role with the literal string `${...}` as its password. */
export function substituteVars(sql: string, vars: Record<string, string>): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => {
    const value = vars[name]
    if (value === undefined) throw new Error(`migration references unresolved variable \${${name}}`)
    return value
  })
}

export type ApplyMigrationsResult = {
  /** Filenames applied during this call, in the order they ran. Empty when the database was already
   * fully migrated -- that is the idempotence contract, not an error. */
  applied: string[]
  /** Filenames that `app._migrations` already listed and were therefore skipped. */
  alreadyApplied: string[]
}

/**
 * Applies every migration file the `app._migrations` table does not yet list, in filename order, each
 * inside its own transaction (a failure partway through a file rolls back only that file, and the
 * table records nothing for it, so re-running `migrate:apply` retries exactly that file next).
 * `connectionString` must authenticate as a role that can create roles/schemas (`0001_roles.sql`
 * creates `devon_migrator`/`devon_app`) -- in every environment this is `MIGRATION_DATABASE_URL`, the
 * Postgres superuser, never `devon_app`.
 */
export async function applyMigrations(
  connectionString: string,
  vars: Record<string, string>,
  files: MigrationFile[] = readMigrationFiles(),
): Promise<ApplyMigrationsResult> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    // Bootstrap-safe: `0000_extensions.sql` also does `create schema if not exists app`, so this
    // never races or conflicts with it -- it just lets the tracking table exist before migration 0000
    // has necessarily run yet (a brand-new database).
    await client.query('create schema if not exists app')
    await client.query(
      `create table if not exists app._migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    )

    const { rows } = await client.query<{ name: string }>('select name from app._migrations')
    const already = new Set(rows.map((r) => r.name))

    const applied: string[] = []
    const alreadyApplied: string[] = []
    // Intentionally sequential, not Promise.all: migration N depends on N-1 having already run
    // (expand-only ordering). A plain indexed loop, not for-of, so the no-await-in-loop lint rule
    // (which only flags for-of bodies, per its own TECH-SPEC §16 comment) does not mistake this for
    // the independent-items case it exists to catch -- same convention as
    // `apps/api/test/checks/pg-fixture.ts`.
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]!
      if (already.has(file.name)) {
        alreadyApplied.push(file.name)
        continue
      }
      const sql = substituteVars(file.sql, vars)
      // nosemgrep: query-in-loop -- see this loop's comment above (strictly ordered migrations).
      await client.query('begin')
      try {
        // nosemgrep: query-in-loop -- same transaction as 'begin' above; strictly ordered.
        await client.query(sql)
        // nosemgrep: query-in-loop -- same transaction as 'begin' above; strictly ordered.
        await client.query('insert into app._migrations (name) values ($1)', [file.name])
        // nosemgrep: query-in-loop -- same transaction as 'begin' above; strictly ordered.
        await client.query('commit')
      } catch (err) {
        // nosemgrep: query-in-loop -- rollback of the same per-migration transaction.
        await client.query('rollback').catch(() => {})
        throw new Error(`migration ${file.name} failed: ${(err as Error).message}`, { cause: err })
      }
      applied.push(file.name)
    }
    return { applied, alreadyApplied }
  } finally {
    await client.end()
  }
}

export type MigrateEnv = {
  MIGRATION_DATABASE_URL?: string
  DATABASE_URL?: string
  POSTGRES_MIGRATOR_PASSWORD?: string
  POSTGRES_APP_PASSWORD?: string
}

function requireEnv(env: MigrateEnv, name: keyof MigrateEnv): string {
  const value = env[name]
  if (!value) throw new Error(`@devon/db migrate: ${name} is not set`)
  return value
}

/** `pnpm --filter @devon/db migrate:apply` (`scripts/start.mjs`'s "applying database migrations"
 * step). Reads connection details from the environment so the CLI wrapper (`src/cli-migrate.ts`)
 * stays a two-line shell. */
export async function runMigrateApply(
  env: MigrateEnv = process.env as MigrateEnv,
): Promise<ApplyMigrationsResult> {
  const connectionString = env.MIGRATION_DATABASE_URL ?? requireEnv(env, 'DATABASE_URL')
  const vars = {
    POSTGRES_MIGRATOR_PASSWORD: requireEnv(env, 'POSTGRES_MIGRATOR_PASSWORD'),
    POSTGRES_APP_PASSWORD: requireEnv(env, 'POSTGRES_APP_PASSWORD'),
  }
  return applyMigrations(connectionString, vars)
}

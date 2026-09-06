// A real Postgres, migrated with the exact SQL files this instance ships (`packages/db/migrations`),
// for the `*:prove` evidence scripts (design.md §9). Deliberately self-contained inside `apps/api`
// (this item's TOUCHES excludes `packages/db`): it *reads* the migration SQL files -- the same
// artefact `packages/db`'s own `migrate:verify` applies -- but does not import that package's
// test-only internals, so this item never depends on anything outside its declared `Depends on`
// (EPIC-000.2, EPIC-000.5).
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

// Matches TECH-SPEC §1.2 (Postgres 17, pgvector 0.8) and packages/db/test/harness.ts's pin -- the plain
// `postgres:17` image has no `vector` extension, so `0000_extensions.sql` would fail against it.
const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.6-pg17'
const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
)

function substituteVars(sql: string, vars: Record<string, string>): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => {
    const value = vars[name]
    if (value === undefined) throw new Error(`migration references unresolved variable \${${name}}`)
    return value
  })
}

export type ProveDatabase = {
  container: StartedPostgreSqlContainer
  appUrl: string
  migratorUrl: string
  superuserUrl: string
  stop(): Promise<void>
}

export async function startProveDatabase(): Promise<ProveDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('devon_prove')
    .withUsername('devon_super')
    .withPassword('devon_prove_super') // example, ephemeral Testcontainers instance only
    .start()

  const migratorPassword = randomBytes(24).toString('base64url')
  const appPassword = randomBytes(24).toString('base64url')
  const superuserUrl = container.getConnectionUri()

  const client = new Client({ connectionString: superuserUrl })
  await client.connect()
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    // Intentionally sequential, not Promise.all: migration N depends on N-1 having already run
    // (expand-only ordering, design.md §2.7). A plain indexed loop, not for-of, so the
    // no-await-in-loop lint rule (which only flags for-of bodies) does not mistake this for the
    // independent-items case it exists to catch.
    for (let i = 0; i < files.length; i += 1) {
      const sql = substituteVars(readFileSync(join(MIGRATIONS_DIR, files[i]!), 'utf8'), {
        POSTGRES_MIGRATOR_PASSWORD: migratorPassword,
        POSTGRES_APP_PASSWORD: appPassword,
      })
      await client.query(sql)
    }
  } finally {
    await client.end()
  }

  const host = container.getHost()
  const port = container.getPort()
  const database = container.getDatabase()
  const appUrl = `postgres://devon_app:${encodeURIComponent(appPassword)}@${host}:${port}/${database}`
  const migratorUrl = `postgres://devon_migrator:${encodeURIComponent(migratorPassword)}@${host}:${port}/${database}`

  return {
    container,
    appUrl,
    migratorUrl,
    superuserUrl,
    async stop() {
      await container.stop()
    },
  }
}

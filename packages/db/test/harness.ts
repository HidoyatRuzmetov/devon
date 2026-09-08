// Shared Testcontainers harness for the migrate-gate suite (design §2.7's `migrate:verify` steps).
// Not part of the public API (packages/db/src/index.ts) -- this is testing infrastructure only.
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

// Pinned to match TECH-SPEC §1.2 (Postgres 17, pgvector 0.8): the plain `postgres:17` image has no
// `vector` extension, so `0000_extensions.sql`'s `create extension vector` would fail against it.
export const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.6-pg17'
export const PGBOUNCER_IMAGE = 'edoburu/pgbouncer:v1.25.2-p0'

export type MigrationFile = { name: string; sql: string }

export function readMigrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

/** Replaces every `${VAR_NAME}` token with `vars[VAR_NAME]`. Throws on an unresolved token so a typo
 * fails loudly at apply time rather than shipping a role with the literal string `${...}` as its
 * password. */
export function substituteVars(sql: string, vars: Record<string, string>): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name: string) => {
    const value = vars[name]
    if (value === undefined) throw new Error(`migration references unresolved variable \${${name}}`)
    return value
  })
}

export type TestCredentials = {
  migratorPassword: string
  appPassword: string
}

export function generateTestCredentials(): TestCredentials {
  return {
    migratorPassword: randomBytes(24).toString('base64url'),
    appPassword: randomBytes(24).toString('base64url'),
  }
}

/** Applies every migration file, in order, as the superuser, substituting `${...}` role passwords.
 * Safe to call twice in a row (idempotence, design §2.7 step 2).
 *
 * Also creates and records into the `app._migrations` bookkeeping table -- the same table
 * `src/migrate.ts`'s production `applyMigrations` creates and maintains -- so that this harness
 * actually mirrors production database state (TENANCY classifies `app._migrations` as `global`, and
 * `test/checks/tenancy.ts` asserts it exists). Recording uses `on conflict do nothing` because this
 * function re-runs every file's raw SQL on each call rather than skipping already-applied ones (that
 * skip-logic lives in production `migrate.ts`, not here), so a second call would otherwise re-insert
 * the same names. */
export async function applyMigrations(
  superuserConnectionString: string,
  creds: TestCredentials,
  files: MigrationFile[] = readMigrationFiles(),
): Promise<void> {
  const client = new Client({ connectionString: superuserConnectionString })
  await client.connect()
  try {
    const vars = {
      POSTGRES_MIGRATOR_PASSWORD: creds.migratorPassword,
      POSTGRES_APP_PASSWORD: creds.appPassword,
    }
    // Bootstrap-safe: `0000_extensions.sql` also does `create schema if not exists app`, so this
    // never races or conflicts with it -- it just lets the tracking table exist before migration 0000
    // has necessarily run yet (a brand-new database). Matches `src/migrate.ts`.
    await client.query('create schema if not exists app')
    await client.query(
      `create table if not exists app._migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    )
    for (const file of files) {
      const sql = substituteVars(file.sql, vars)
      try {
        await client.query(sql)
        await client.query(
          'insert into app._migrations (name) values ($1) on conflict (name) do nothing',
          [file.name],
        )
      } catch (err) {
        throw new Error(`migration ${file.name} failed: ${(err as Error).message}`, { cause: err })
      }
    }
  } finally {
    await client.end()
  }
}

export type DatabaseFixture = {
  container: StartedPostgreSqlContainer
  network: StartedNetwork
  creds: TestCredentials
  superuserUrl: string
  host: string
  port: number
  database: string
  networkAlias: string
  migratorUrl: string
  appUrl: string
  stop(): Promise<void>
}

/** Starts one Postgres container on its own Docker network (so a PgBouncer container can join the same
 * network by alias), applies every migration once, and returns ready-to-use connection strings for the
 * superuser, `devon_migrator` and `devon_app`. */
export async function startMigratedDatabase(): Promise<DatabaseFixture> {
  const network = await new Network().start()
  const networkAlias = 'pg'
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('devon_test')
    .withUsername('devon_super')
    .withPassword('devon_test_super')
    .withNetwork(network)
    .withNetworkAliases(networkAlias)
    .start()

  const creds = generateTestCredentials()
  const superuserUrl = container.getConnectionUri()
  await applyMigrations(superuserUrl, creds)

  const host = container.getHost()
  const port = container.getPort()
  const database = container.getDatabase()
  const migratorUrl = `postgres://devon_migrator:${encodeURIComponent(creds.migratorPassword)}@${host}:${port}/${database}`
  const appUrl = `postgres://devon_app:${encodeURIComponent(creds.appPassword)}@${host}:${port}/${database}`

  return {
    container,
    network,
    creds,
    superuserUrl,
    host,
    port,
    database,
    networkAlias,
    migratorUrl,
    appUrl,
    async stop() {
      await container.stop()
      await network.stop()
    },
  }
}

export type PgBouncerFixture = {
  container: StartedTestContainer
  connectionString: string
  stop(): Promise<void>
}

/** Starts PgBouncer in transaction-pooling mode, `default_pool_size=2` (design §4(a)'s exact
 * reproduction of the PgBouncer-transaction-pooling leak scenario), pointed at the already-migrated
 * Postgres container over the shared Docker network. */
export async function startPgBouncer(db: DatabaseFixture): Promise<PgBouncerFixture> {
  const container = await new GenericContainer(PGBOUNCER_IMAGE)
    .withNetwork(db.network)
    .withEnvironment({
      DB_HOST: db.networkAlias,
      DB_PORT: '5432',
      DB_USER: 'devon_app',
      DB_PASSWORD: db.creds.appPassword,
      DB_NAME: db.database,
      POOL_MODE: 'transaction',
      DEFAULT_POOL_SIZE: '2',
      MAX_CLIENT_CONN: '100',
      AUTH_TYPE: 'scram-sha-256',
      ADMIN_USERS: 'devon_app',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/process up/i))
    .withStartupTimeout(60_000)
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(5432)
  const connectionString = `postgres://devon_app:${encodeURIComponent(db.creds.appPassword)}@${host}:${port}/${db.database}`

  // `Wait.forLogMessage(/process up/i)` resolves as soon as that line hits stdout, which on Docker
  // Desktop for Windows can fire a short window before the *published* port is actually accepting TCP
  // connections yet (observed: `ECONNREFUSED` on the very next connection attempt even though
  // `.start()` itself never timed out -- a container-readiness race, not a PgBouncer misconfiguration;
  // see `agentic/ledger/hardening/*/baseline.md` §6 "migrate" for the first reproduction). Poll with a
  // real connection attempt instead of trusting the log line alone, bounded so a genuinely broken
  // PgBouncer still fails fast rather than hanging.
  const deadline = Date.now() + 10_000
  let lastErr: unknown
  for (;;) {
    const probe = new Client({ connectionString, connectionTimeoutMillis: 2_000 })
    try {
      await probe.connect()
      await probe.end()
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      await probe.end().catch(() => {})
      if (Date.now() >= deadline) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  if (lastErr) {
    await container.stop().catch(() => {})
    throw new Error(
      `startPgBouncer: port ${port} never accepted a connection within 10s of "process up"`,
      { cause: lastErr },
    )
  }

  return {
    container,
    connectionString,
    async stop() {
      await container.stop()
    },
  }
}

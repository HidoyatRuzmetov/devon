// The only exported way to reach Postgres (design §1.8). `Pool` is module-private: nothing outside
// this file can obtain a raw connection, so every query is forced through `withContext()`, which sets
// the tenancy GUCs as its first statement, in the same transaction, `SET LOCAL` semantics
// (`set_config(..., true)`) so a PgBouncer transaction-pooled connection never carries one request's
// context into the next (design §4(a), H3.3).
import type { SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'
import {
  insertAuditEvent,
  insertPrivateRead,
  type AuditEventInput,
  type PrivateReadInput,
} from './audit.js'
import { insertOutboxEvent, type OutboxEventInput } from './events.js'
import * as schema from './schema/index.js'

export type Role = 'super_admin' | 'head' | 'member'

export type RequestContext = {
  requestId: string
  userId: string | null
  actorRole: Role | null
  departmentId: string | null
  actingForUserId: string | null
  viewAs: boolean
  ip: string
  userAgent: string
}

export type { AuditEventInput, PrivateReadInput } from './audit.js'
export type { OutboxEventInput, OutboxEventRecord } from './events.js'

/** Thrown by `Tx.raw()` when the transaction it was called on did not originate from `withContext()`
 * (or has already ended -- see the guard below). Never caught silently: a caller seeing this has a
 * connection-handling bug, not a permission problem. */
export class TenancyContextMissing extends Error {
  constructor(message = 'Tenancy context is not set; raw() must run inside withContext()') {
    super(message)
    this.name = 'TenancyContextMissing'
  }
}

export interface Tx {
  readonly drizzle: NodePgDatabase<typeof schema>
  /** The raw-query escape hatch (AC-10). Asserts the GUCs are set, once per transaction, before
   * executing. Throws `TenancyContextMissing` outside `withContext`. */
  raw<R = unknown>(query: SQL): Promise<R[]>
  /** I-5: buffered, flushed inside THIS transaction, right before commit. Never a separate connection. */
  audit(event: AuditEventInput): void
  /** I-2: records a Restricted-field read by the head or the super admin. */
  privateRead(input: PrivateReadInput): void
  /** Domain event bus (MODULE-GUIDE.md "Domain events"): buffered and flushed inside THIS transaction,
   * right before commit, exactly like `audit()` -- an event can never be observed by a worker before
   * the write that caused it has actually committed. */
  emit(event: OutboxEventInput): void
}

// Module-private connection pool. Not exported under any name, by design (handoff contract).
let pool: Pool | null = null

// H3.3 "pool sizing per process": `new Pool({ connectionString })` with no `max` used to fall back to
// `node-postgres`'s default of 10 for the whole process -- verified as the exact cause of the p95
// cliff between 10 and 100 concurrent requests measured in the hardening baseline (every one of
// board-load/card-move/RSVP/analytics-summary went from ~35ms to 600-1300ms p95 right where 100
// concurrent in-flight requests started queueing for one of only 10 pool slots; see
// `agentic/ledger/hardening/*/baseline.md` §4). Every value below is process-wide and env-overridable
// so `api`, `worker` and any future process (`infra/docker-compose.yml`'s separate services) can be
// sized independently against Postgres's own `max_connections` (default 100) without a code change --
// e.g. one `api` replica at `DB_POOL_MAX=20` plus one `worker` at `DB_POOL_MAX=10` plus headroom for
// direct/admin connections and pgBackRest comfortably fits under 100.
function poolEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function getPool(): Pool {
  if (pool) return pool
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('@devon/db: DATABASE_URL is not set')
  }
  pool = new Pool({
    connectionString,
    // Sized, not left at node-postgres's default of 10 (H3.3). Override per process via env.
    max: poolEnvInt('DB_POOL_MAX', 20),
    min: poolEnvInt('DB_POOL_MIN', 2),
    // A connection idle longer than this is closed, not held open forever -- bounds the pool back
    // down toward `min` once a traffic spike passes (H11.1 "bounded ... caches").
    idleTimeoutMillis: poolEnvInt('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
    // Fail fast with a clear pool-exhaustion error instead of a request hanging indefinitely when
    // every slot is busy (H8.1 "graceful degradation", H16.1 "no ... stuck" loading states) -- a
    // request that cannot get a connection within 5s is not going to get useful work done anyway.
    connectionTimeoutMillis: poolEnvInt('DB_POOL_CONN_TIMEOUT_MS', 5_000),
    // Per-statement ceiling so one runaway query cannot hold a connection (and its transaction's
    // locks) forever -- PgBouncer-safe because it is a `pg` client-side option sent as a startup
    // parameter on every physical connection, not a session `SET` that could leak across a pooled
    // connection's next borrower (H3.3's `set_config(..., true)` note above is the analogous
    // guarantee for the tenancy GUCs).
    statement_timeout: poolEnvInt('DB_STATEMENT_TIMEOUT_MS', 15_000),
  })
  return pool
}

/**
 * Test/bootstrap-only escape hatch: point the module-private pool at a different connection string
 * (a Testcontainers instance, or a just-provisioned database) without ever exporting `Pool` itself.
 * Production code never calls this -- it reads `DATABASE_URL` once, lazily, on first use.
 */
export function configurePool(connectionString: string): void {
  const previous = pool
  pool = new Pool({ connectionString })
  if (previous) void previous.end()
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool
    pool = null
    await p.end()
  }
}

/**
 * A raw connection with no tenancy GUCs set -- for the one kind of caller that is legitimately
 * cross-department by nature: the outbox worker (`src/events-worker.ts`), draining events across every
 * department at once. `app.outbox_events` carries no RLS policy (it is `global` in `tenancy.ts`, same
 * class as `audit.events`), so this cannot be used to bypass a department-scoped table's row security
 * -- an RLS-protected table simply returns zero rows to a connection with no department GUC set, it
 * does not leak. Not exported from `src/index.ts` (the package's public API): only the worker needs it.
 */
export async function withRawClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

function toGuc(value: string | null | undefined): string {
  return value ?? ''
}

// Postgres OIDs for `timestamp`/`timestamptz` only (`select oid, typname from pg_type where typname
// in ('timestamp','timestamptz')` -- stable, built-in system OIDs, never per-database). Deliberately
// NOT `date` (OID 1082): plain `date` columns (`projects.start_on`/`target_on`, ...) are modelled
// end to end as bare `YYYY-MM-DD` strings -- `schemas.ts`'s `z.string()`, not `z.coerce.date()` --
// reviving those to real `Date`s here would break their response schemas the same way leaving
// `timestamptz` unrevived breaks everything below. Drizzle's own node-postgres driver setup
// (`drizzle-orm/node-postgres/session.ts`) deliberately overrides the node-postgres type parser for
// timestamp-shaped OIDs to hand back the server's raw text instead of a parsed `Date` -- correct for
// drizzle's *typed* query builder (`Tx.drizzle`), which does its own column-aware parsing afterwards,
// but `Tx.raw()` has no column metadata to parse *with*, so every caller across the codebase that
// types a raw row's timestamp column as `Date` (there are dozens -- `structure/repo.ts`'s
// `assigned_at`, `events/repo.ts`'s `starts_at`, `accounts/repo.ts`'s `expires_at`, ...) was actually
// holding a string at runtime and crashing the first time it called `.toISOString()`/`.getTime()`
// (H1, found live: "assigned_at.toISOString is not a function"). Fixed once, here, using the query
// result's own field metadata (`pg`'s `QueryResult.fields[].dataTypeID`) to convert exactly the
// columns Postgres itself says are timestamp/timestamptz -- never a string-shape guess -- so every
// existing `Date`-typed raw row genuinely is one from this point on.
const TIMESTAMP_OIDS = new Set([1114, 1184]) // timestamp, timestamptz

function reviveTimestamps<R>(
  rows: R[],
  fields: readonly { name: string; dataTypeID: number }[] | undefined,
): R[] {
  if (!fields || fields.length === 0 || rows.length === 0) return rows
  const dateColumns = fields.filter((f) => TIMESTAMP_OIDS.has(f.dataTypeID)).map((f) => f.name)
  if (dateColumns.length === 0) return rows
  for (const row of rows) {
    const record = row as Record<string, unknown>
    for (const col of dateColumns) {
      const value = record[col]
      if (typeof value === 'string') record[col] = new Date(value)
    }
  }
  return rows
}

export async function withContext<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect()
  try {
    await client.query('begin')
    try {
      await client.query(
        `select set_config('app.request_id', $1, true),
                set_config('app.user_id', $2, true),
                set_config('app.actor_role', $3, true),
                set_config('app.department_id', $4, true),
                set_config('app.view_as', $5, true)`,
        [
          ctx.requestId,
          toGuc(ctx.userId),
          toGuc(ctx.actorRole),
          toGuc(ctx.departmentId),
          ctx.viewAs ? 'true' : 'false',
        ],
      )

      const db = drizzle(client, { schema })
      const auditQueue: AuditEventInput[] = []
      const privateReadQueue: PrivateReadInput[] = []
      const eventQueue: OutboxEventInput[] = []
      let contextVerified: boolean | null = null

      const assertContextEstablished = async (): Promise<void> => {
        if (contextVerified !== null) {
          if (!contextVerified) throw new TenancyContextMissing()
          return
        }
        const { rows } = await client.query<{ v: string | null }>(
          "select current_setting('app.request_id', true) as v",
        )
        contextVerified = rows[0]?.v === ctx.requestId
        if (!contextVerified) throw new TenancyContextMissing()
      }

      const tx: Tx = {
        drizzle: db,
        async raw<R = unknown>(query: SQL): Promise<R[]> {
          await assertContextEstablished()
          const result = await db.execute(query)
          return reviveTimestamps([...result.rows], result.fields) as R[]
        },
        audit(event) {
          auditQueue.push(event)
        },
        privateRead(input) {
          privateReadQueue.push(input)
        },
        emit(event) {
          eventQueue.push(event)
        },
      }

      const result = await fn(tx)

      // I-5: flush inside this transaction, before commit, so a domain write and its audit row are
      // atomic. If `fn` threw, we never reach here and the rollback below discards everything. A
      // single `pg` connection pipelines queries in submission order regardless, so `Promise.all`
      // here does not reorder the chain -- it just avoids an await-in-a-loop over independent rows.
      await Promise.all(auditQueue.map((event) => insertAuditEvent(client, ctx, event)))
      await Promise.all(privateReadQueue.map((input) => insertPrivateRead(client, ctx, input)))
      // Same atomicity argument as the audit queue above, applied to the outbox: a subscriber must
      // never be able to observe an event whose causing write did not, in the end, commit.
      await Promise.all(eventQueue.map((event) => insertOutboxEvent(client, ctx, event)))

      await client.query('commit')
      return result
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    }
  } finally {
    client.release()
  }
}

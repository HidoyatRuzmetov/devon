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
}

// Module-private connection pool. Not exported under any name, by design (handoff contract).
let pool: Pool | null = null

function getPool(): Pool {
  if (pool) return pool
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('@devon/db: DATABASE_URL is not set')
  }
  pool = new Pool({ connectionString })
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

function toGuc(value: string | null | undefined): string {
  return value ?? ''
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
          return [...result.rows] as R[]
        },
        audit(event) {
          auditQueue.push(event)
        },
        privateRead(input) {
          privateReadQueue.push(input)
        },
      }

      const result = await fn(tx)

      // I-5: flush inside this transaction, before commit, so a domain write and its audit row are
      // atomic. If `fn` threw, we never reach here and the rollback below discards everything. A
      // single `pg` connection pipelines queries in submission order regardless, so `Promise.all`
      // here does not reorder the chain -- it just avoids an await-in-a-loop over independent rows.
      await Promise.all(auditQueue.map((event) => insertAuditEvent(client, ctx, event)))
      await Promise.all(privateReadQueue.map((input) => insertPrivateRead(client, ctx, input)))

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

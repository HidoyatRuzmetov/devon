// Backs `test/integration/rls.isolation.test.ts` and `migrate:verify` (design §2.4/§4(a), item AC-10).
// Deliberately exercises the *production* code path -- `withContext()`/`Tx.drizzle`/`tx.raw()` from
// `../../src/context.js` -- rather than a reimplementation, so a bug in the real wrapper shows up here.
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { configurePool, withContext, type RequestContext } from '../../src/context.js'
import * as schema from '../../src/schema/index.js'
import type { CheckResult } from './types.js'

export type SeededDepartment = { departmentId: string; userId: string }

/** Seeds N departments, one user and one active membership each, directly as the superuser (which
 * bypasses RLS even under FORCE, per Postgres semantics) -- RLS itself is exactly what is under test,
 * so fixture setup must not go through it. */
export async function seedDepartments(
  superuserConnectionString: string,
  count: number,
): Promise<SeededDepartment[]> {
  const client = new Client({ connectionString: superuserConnectionString })
  await client.connect()
  try {
    const out: SeededDepartment[] = []
    for (let i = 0; i < count; i += 1) {
      const suffix = `${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`
      const dept = await client.query<{ id: string }>(
        `insert into app.departments (name, slug) values ($1, $2) returning id`,
        [`RLS probe ${suffix}`, `rls-probe-${suffix}`],
      )
      const departmentId = dept.rows[0]!.id
      const user = await client.query<{ id: string }>(
        `insert into app.users (login, password_hash, given_name, family_name)
         values ($1, 'x', 'Probe', $2) returning id`,
        [`rls-probe-${suffix}`, suffix],
      )
      const userId = user.rows[0]!.id
      await client.query(
        `insert into app.memberships (department_id, user_id, role) values ($1, $2, 'member')`,
        [departmentId, userId],
      )
      out.push({ departmentId, userId })
    }
    return out
  } finally {
    await client.end()
  }
}

function contextFor(seeded: SeededDepartment, requestId: string): RequestContext {
  return {
    requestId,
    userId: seeded.userId,
    actorRole: 'member',
    departmentId: seeded.departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'rls-probe',
  }
}

/** Drizzle path + `tx.raw()` path, both ways round (A cannot see B, B cannot see A), against the real
 * `app.departments` and `app.memberships` tables. */
export async function runRlsIsolationChecks(
  appConnectionString: string,
  seeded: SeededDepartment[],
): Promise<CheckResult[]> {
  configurePool(appConnectionString)
  const results: CheckResult[] = []
  const [a, b] = seeded
  if (!a || !b) throw new Error('runRlsIsolationChecks needs at least two seeded departments')

  await withContext(contextFor(a, 'probe-a-drizzle'), async (tx) => {
    const memberships = await tx.drizzle.select().from(schema.memberships)
    results.push({
      name: 'Drizzle path: department A context sees only department A memberships',
      ok: memberships.length > 0 && memberships.every((m) => m.departmentId === a.departmentId),
      detail: `rows=${memberships.length}`,
    })

    const departments = await tx.drizzle.select().from(schema.departments)
    results.push({
      name: 'Drizzle path: department A context sees zero rows of department B (departments)',
      ok: !departments.some((d) => d.id === b.departmentId),
    })
  })

  await withContext(contextFor(a, 'probe-a-raw'), async (tx) => {
    const rows = await tx.raw<{ department_id: string }>(
      sql`select department_id from app.memberships`,
    )
    results.push({
      name: 'tx.raw() path: department A context sees zero rows of department B (memberships)',
      ok: rows.length > 0 && !rows.some((r) => r.department_id === b.departmentId),
      detail: `rows=${rows.length}`,
    })
  })

  await withContext(contextFor(b, 'probe-b-drizzle'), async (tx) => {
    const memberships = await tx.drizzle.select().from(schema.memberships)
    results.push({
      name: 'Drizzle path: department B context sees only department B memberships',
      ok: memberships.length > 0 && memberships.every((m) => m.departmentId === b.departmentId),
    })
  })

  await withContext(contextFor(b, 'probe-b-raw'), async (tx) => {
    const rows = await tx.raw<{ department_id: string }>(
      sql`select department_id from app.memberships`,
    )
    results.push({
      name: 'tx.raw() path: department B context sees zero rows of department A (memberships)',
      ok: rows.length > 0 && !rows.some((r) => r.department_id === a.departmentId),
    })
  })

  await withContext({ ...contextFor(a, 'probe-no-context'), departmentId: null }, async (tx) => {
    const memberships = await tx.drizzle.select().from(schema.memberships)
    results.push({
      name: 'unset department context returns zero rows, never all rows (default-deny)',
      ok: memberships.length === 0,
      detail: `rows=${memberships.length}`,
    })
  })

  return results
}

async function probeOneTransaction(
  connectionString: string,
  seeded: SeededDepartment,
): Promise<{ ok: boolean; detail?: string }> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(
      `select set_config('app.request_id', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.actor_role', 'member', true),
              set_config('app.department_id', $3, true),
              set_config('app.view_as', 'false', true)`,
      [
        `pgbouncer-probe-${Math.random().toString(36).slice(2)}`,
        seeded.userId,
        seeded.departmentId,
      ],
    )
    // A small random delay widens the window in which PgBouncer might hand this logical connection's
    // physical server connection to a different concurrent transaction between statements.
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25)))
    const { rows } = await client.query<{ department_id: string }>(
      'select department_id from app.memberships',
    )
    const foreign = rows.filter((r) => r.department_id !== seeded.departmentId)
    await client.query('commit')
    return foreign.length === 0
      ? { ok: true }
      : {
          ok: false,
          detail: `department ${seeded.departmentId} saw ${foreign.length} foreign row(s)`,
        }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    return { ok: false, detail: (err as Error).message }
  } finally {
    await client.end()
  }
}

/** The PgBouncer-transaction-pooling reproduction named in the item's handoff: 20 concurrent
 * transactions, interleaved across the seeded departments, through a `default_pool_size=2` PgBouncer
 * in `transaction` mode -- the exact scenario where a plain `SET` (instead of `set_config(..., true)`)
 * would leak one request's department context onto the next request sharing the physical connection
 * (design §4(a)). */
export async function runPgBouncerConcurrencyCheck(
  pgBouncerConnectionString: string,
  seeded: SeededDepartment[],
  attempts = 20,
): Promise<CheckResult[]> {
  const outcomes = await Promise.all(
    Array.from({ length: attempts }, (_, i) =>
      probeOneTransaction(pgBouncerConnectionString, seeded[i % seeded.length]!),
    ),
  )
  const failures = outcomes.filter((o) => !o.ok)
  return [
    {
      name: `${attempts} concurrent transactions through PgBouncer (pool_mode=transaction, default_pool_size=2) show zero cross-department rows`,
      ok: failures.length === 0,
      detail: failures.map((f) => f.detail).join('; '),
    },
  ]
}

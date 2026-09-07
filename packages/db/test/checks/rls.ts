// Backs `test/integration/rls.isolation.test.ts` and `migrate:verify` (design §2.4/§4(a), item AC-10).
// Deliberately exercises the *production* code path -- `withContext()`/`Tx.drizzle`/`tx.raw()` from
// `../../src/context.js` -- rather than a reimplementation, so a bug in the real wrapper shows up here.
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { configurePool, withContext, type RequestContext } from '../../src/context.js'
import * as schema from '../../src/schema/index.js'
import { TENANCY } from '../../src/tenancy.js'
import type { CheckResult } from './types.js'

export type SeededDepartment = { departmentId: string; userId: string }

/** Every `department_owned` table in the registry except `app.memberships` -- the one table with the
 * I-1a self-read carve-out (`agentic/INVARIANTS.md`). With no department context set, each of these must
 * return zero rows to the application role, whatever the caller's `app.user_id` is. Derived from the
 * registry rather than hand-listed so a newly registered table joins the sweep automatically. */
export const STRICT_DEFAULT_DENY_TABLES: readonly string[] = Object.entries(TENANCY)
  .filter(([name, cls]) => cls === 'department_owned' && name !== 'app.memberships')
  .map(([name]) => name)

/** The tables `seedDepartments()` puts a row into per department, so the sweep over them is
 * non-vacuous: an empty table returns zero rows to anyone and proves nothing. */
export const SEEDED_STRICT_TABLES: readonly string[] = ['app.units', 'app.cards']

/** Seeds N departments, one user, one active membership, one unit and one card each, directly as the
 * superuser (which bypasses RLS even under FORCE, per Postgres semantics) -- RLS itself is exactly what
 * is under test, so fixture setup must not go through it. */
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
      // One ordinary department-owned row on two unrelated modules' tables (structure, work), so the
      // no-context default-deny sweep below has something real to hide.
      await client.query(
        `insert into app.units (department_id, name, created_by) values ($1, $2, $3)`,
        [departmentId, `RLS probe unit ${suffix}`, userId],
      )
      await client.query(
        `insert into app.cards (department_id, title, created_by_user_id) values ($1, $2, $3)`,
        [departmentId, `RLS probe card ${suffix}`, userId],
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

const QUALIFIED_NAME = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/

/** One statement counting every listed table -- `select 't', count(*) from t union all ...` -- so the
 * sweep is a single round trip for each role rather than a query per table. Names come from the frozen
 * `TENANCY` registry, and are re-validated here so a malformed entry can never reach the SQL text. */
function countEveryTableSql(tables: readonly string[]): string {
  return tables
    .map((qualified) => {
      if (!QUALIFIED_NAME.test(qualified)) {
        throw new Error(`refusing to probe malformed table name ${JSON.stringify(qualified)}`)
      }
      const [schemaName, table] = qualified.split('.') as [string, string]
      return `select '${qualified}' as t, count(*)::int as n from "${schemaName}"."${table}"`
    })
    .join(' union all ')
}

async function countAsSuperuser(
  superuserConnectionString: string,
  tables: readonly string[],
): Promise<Map<string, number>> {
  const client = new Client({ connectionString: superuserConnectionString })
  await client.connect()
  try {
    const { rows } = await client.query<{ t: string; n: number }>(countEveryTableSql(tables))
    return new Map(rows.map((r) => [r.t, r.n]))
  } finally {
    await client.end()
  }
}

/** Drizzle path + `tx.raw()` path, both ways round (A cannot see B, B cannot see A), against the real
 * `app.departments` and `app.memberships` tables; then the no-department-context probes: the I-1a
 * self-read carve-out on `app.memberships` (and its one-join-away shadow on `app.departments`) never
 * crosses users, and every other department-owned table stays strictly zero rows. */
export async function runRlsIsolationChecks(
  appConnectionString: string,
  seeded: SeededDepartment[],
  superuserConnectionString: string,
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

  // I-1a (`agentic/INVARIANTS.md`, decided 2026-09-06 via docs/04-escalations/
  // INTEGRATION-memberships-self-read-vs-I-1.md): `app.memberships` carries additive self-read policies
  // (`memberships_read_own`, `migrations/0100_accounts_departments.sql`; `memberships_self_read`,
  // `0200_structure.sql`; the `or user_id = ...` arm of `memberships_read`, `0303_...sql`), all
  // `user_id = app.current_user_id()` only, because `GET /me` / `Actor.memberships` must list every
  // department a user belongs to before any department context exists -- resolving that list is what
  // *establishes* the context. So on this one table an unset department context does not mean zero
  // rows; it means "only the calling user's own row(s), never anyone else's". That is the guarantee
  // asserted here.
  await withContext({ ...contextFor(a, 'probe-no-context'), departmentId: null }, async (tx) => {
    const memberships = await tx.drizzle.select().from(schema.memberships)
    results.push({
      name: 'unset department context on app.memberships never crosses users (I-1a self-read carve-out)',
      ok: memberships.every((m) => m.userId === a.userId),
      detail: `rows=${memberships.length}`,
    })

    // `app.departments` (`tenant_root`) has the same read one join away: `departments_self_read`
    // (`0200_structure.sql`) shows a department row without context iff one of the caller's own active
    // memberships points at it -- `listActiveMembershipsForUser` (`apps/api/src/db/repo.ts`) joins the
    // two to give `GET /me` its department names. Never another department's row.
    const departments = await tx.drizzle.select().from(schema.departments)
    results.push({
      name: "unset department context on app.departments shows only the caller's own departments (I-1a, one join away), never another department",
      ok: departments.every((d) => d.id === a.departmentId),
      detail: `rows=${departments.length}`,
    })
  })

  // A user with no memberships of their own at all (every `seedDepartments()` user has exactly one,
  // in their own department, so this has to be a fresh id, not one of `seeded`) must still see zero
  // rows of both tables with no department context -- proving the carve-out is genuinely self-scoped,
  // not "any authenticated user sees everything once department_id is null".
  await withContext(
    { ...contextFor(a, 'probe-no-context-stranger'), userId: randomUUID(), departmentId: null },
    async (tx) => {
      const memberships = await tx.drizzle.select().from(schema.memberships)
      results.push({
        name: 'unset department context returns zero app.memberships rows for a user with no memberships of their own',
        ok: memberships.length === 0,
        detail: `rows=${memberships.length}`,
      })
      const departments = await tx.drizzle.select().from(schema.departments)
      results.push({
        name: 'unset department context returns zero app.departments rows for a user with no memberships of their own',
        ok: departments.length === 0,
        detail: `rows=${departments.length}`,
      })
    },
  )

  // Every other department-owned table has no carve-out at all: unset department context must mean
  // zero rows (default-deny), even for a signed-in user who is a member somewhere and even though the
  // superuser can see rows exist. Counted as the superuser first so a "zero rows" result on an empty
  // table is reported as vacuous rather than passed off as proof.
  const total = await countAsSuperuser(superuserConnectionString, STRICT_DEFAULT_DENY_TABLES)
  const visible = await withContext(
    { ...contextFor(a, 'probe-no-context-sweep'), departmentId: null },
    async (tx) => {
      const rows = await tx.raw<{ t: string; n: number }>(
        sql.raw(countEveryTableSql(STRICT_DEFAULT_DENY_TABLES)),
      )
      return new Map(rows.map((r) => [r.t, r.n]))
    },
  )
  for (const table of STRICT_DEFAULT_DENY_TABLES) {
    const seen = visible.get(table) ?? -1
    const exists = total.get(table) ?? -1
    results.push({
      name: `unset department context sees zero rows of ${table} (default-deny, no self-read carve-out)`,
      ok: seen === 0 && exists >= 0,
      detail:
        exists === 0
          ? 'total=0 (nothing to hide yet -- vacuous until a seed puts rows here)'
          : `total=${exists} visible=${seen}`,
    })
  }
  const vacuous = SEEDED_STRICT_TABLES.filter((t) => (total.get(t) ?? 0) < seeded.length)
  results.push({
    name: `default-deny sweep is non-vacuous: ${SEEDED_STRICT_TABLES.join(', ')} hold seeded rows the caller cannot see`,
    ok: vacuous.length === 0 && SEEDED_STRICT_TABLES.every((t) => visible.get(t) === 0),
    detail: SEEDED_STRICT_TABLES.map(
      (t) => `${t}: total=${total.get(t)} visible=${visible.get(t)}`,
    ).join('; '),
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

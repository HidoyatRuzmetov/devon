// Backs `test/integration/tenancy.registry.test.ts` and `migrate:verify` (design §2.1, item AC-10).
import type { ClientBase } from 'pg'
import { departmentTableDDL, dropTableDDL, userTableDDL } from '../../src/rls.js'
import { checkTenancyCoverage, TENANCY } from '../../src/tenancy.js'
import {
  columnExists,
  foreignKeyExists,
  grantsFor,
  leadingIndexColumn,
  listBaseTables,
  policies,
  rlsState,
  tableOwner,
  triggerExists,
} from './introspect.js'
import type { CheckResult } from './types.js'

const REFERENCES_DEPARTMENT_FN = (expr: string | null) =>
  !!expr && expr.includes('current_department_id')
const REFERENCES_ACTOR_ROLE_FN = (expr: string | null) =>
  !!expr && expr.includes('current_actor_role')
const REFERENCES_USER_FN = (expr: string | null) => !!expr && expr.includes('current_user_id')
/** The shape of a self-read carve-out: a policy expression that keys on the caller's user id with no
 * department condition anywhere in it (`using (user_id = app.current_user_id())`). */
const KEYS_ON_USER_ALONE = (expr: string | null) =>
  REFERENCES_USER_FN(expr) && !REFERENCES_DEPARTMENT_FN(expr)

/** I-1a (`agentic/INVARIANTS.md`): the one permitted self-read carve-out is a signed-in user reading
 * their OWN `app.memberships` rows with no department context, plus its one-join-away shadow on
 * `app.departments` (`departments_self_read`: a department row is visible iff one of the caller's own
 * active memberships points at it -- what `listActiveMembershipsForUser` joins for `GET /me`). No other
 * department-owned or tenant-root table may carry a policy of that shape; adding one fails this gate. */
const SELF_READ_CARVE_OUT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'app.memberships': ['memberships_read_own', 'memberships_self_read'],
  'app.departments': ['departments_self_read'],
})

export async function runTenancyRegistryChecks(client: ClientBase): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const push = (name: string, ok: boolean, detail?: string) => results.push({ name, ok, detail })

  const tables = await listBaseTables(client, ['app', 'audit'])
  const coverage = checkTenancyCoverage(tables)
  push(
    'every base table in app/audit is classified in TENANCY',
    coverage.unclassified.length === 0,
    coverage.unclassified.join(', '),
  )
  push(
    'every global-classified table has a GLOBAL_ALLOWLIST justification',
    coverage.unjustifiedGlobals.length === 0,
    coverage.unjustifiedGlobals.join(', '),
  )

  for (const [qualified, cls] of Object.entries(TENANCY)) {
    const [schema = '', table = ''] = qualified.split('.')
    if (!tables.includes(qualified)) {
      push(`${qualified} exists as a base table`, false)
      continue
    }

    const owner = await tableOwner(client, schema, table)
    push(`${qualified} is not owned by devon_app`, owner !== 'devon_app', owner ?? 'unknown')

    if (cls === 'department_owned' || cls === 'tenant_root') {
      const rls = await rlsState(client, schema, table)
      push(`${qualified} has RLS enabled and forced`, rls.enabled && rls.forced)
      const allowed = SELF_READ_CARVE_OUT[qualified] ?? []
      const rogue = (await policies(client, schema, table))
        .filter((p) => KEYS_ON_USER_ALONE(p.qual) || KEYS_ON_USER_ALONE(p.withCheck))
        .map((p) => p.policyname)
        .filter((name) => !allowed.includes(name))
      push(
        `${qualified} has no self-read carve-out beyond I-1a (no policy keys on current_user_id() without current_department_id())`,
        rogue.length === 0,
        rogue.join(', '),
      )
    }

    if (cls === 'department_owned') {
      const hasColumn = await columnExists(client, schema, table, 'department_id')
      push(`${qualified} has a department_id column`, hasColumn)
      const hasFk = await foreignKeyExists(
        client,
        schema,
        table,
        'department_id',
        'app',
        'departments',
      )
      push(`${qualified}.department_id references app.departments`, hasFk)
      const pol = await policies(client, schema, table)
      const scoped = pol.some(
        (p) => REFERENCES_DEPARTMENT_FN(p.qual) || REFERENCES_DEPARTMENT_FN(p.withCheck),
      )
      push(`${qualified} has a policy referencing app.current_department_id()`, scoped)
      const leading = await leadingIndexColumn(client, schema, table, 'department_id')
      push(`${qualified} has an index leading with department_id`, leading)
    }

    if (cls === 'tenant_root') {
      const pol = await policies(client, schema, table)
      const scoped = pol.some(
        (p) =>
          REFERENCES_DEPARTMENT_FN(p.qual) ||
          REFERENCES_DEPARTMENT_FN(p.withCheck) ||
          REFERENCES_ACTOR_ROLE_FN(p.qual) ||
          REFERENCES_ACTOR_ROLE_FN(p.withCheck),
      )
      push(
        `${qualified} has a policy referencing id=current_department_id() or super_admin`,
        scoped,
      )
    }

    if (cls === 'user_owned') {
      const hasColumn = await columnExists(client, schema, table, 'user_id')
      push(`${qualified} has a user_id column`, hasColumn)
      const rls = await rlsState(client, schema, table)
      push(`${qualified} has RLS enabled and forced`, rls.enabled && rls.forced)
      const pol = await policies(client, schema, table)
      const scoped = pol.some((p) => REFERENCES_USER_FN(p.qual) || REFERENCES_USER_FN(p.withCheck))
      push(`${qualified} has a policy referencing app.current_user_id()`, scoped)
      const mentionsRole = pol.some(
        (p) => REFERENCES_ACTOR_ROLE_FN(p.qual) || REFERENCES_ACTOR_ROLE_FN(p.withCheck),
      )
      push(
        `${qualified} has no policy mentioning current_actor_role() (I-1: no head/admin exception)`,
        !mentionsRole,
      )
    }

    if (cls === 'audit') {
      const grants = await grantsFor(client, schema, table, 'devon_app')
      const exact = [...grants].sort().join(',') === 'INSERT,SELECT'
      push(`${qualified}: devon_app grants are exactly INSERT, SELECT`, exact, grants.join(','))
    }
  }

  for (const trigger of [
    'events_no_update',
    'events_no_delete',
    'events_no_truncate',
    'events_chain',
  ]) {
    push(
      `audit.events has trigger ${trigger}`,
      await triggerExists(client, 'audit', 'events', trigger),
    )
  }

  // The registry test additionally proves the *mechanism* generically, per design §2.1, by creating
  // two throwaway tables through the same `departmentTable()`/`userTable()` helpers a feature engineer
  // would reach for, rather than trusting that the two real tables happen to be representative.
  const deptName = 'zz_registry_probe_department_owned'
  const userName = 'zz_registry_probe_user_owned'
  try {
    for (const stmt of departmentTableDDL('app', deptName)) await client.query(stmt)
    for (const stmt of userTableDDL('app', userName)) await client.query(stmt)

    const deptRls = await rlsState(client, 'app', deptName)
    push(
      'throwaway department_owned table has RLS enabled and forced',
      deptRls.enabled && deptRls.forced,
    )
    const deptPol = await policies(client, 'app', deptName)
    push(
      'throwaway department_owned table has a policy referencing app.current_department_id()',
      deptPol.some(
        (p) => REFERENCES_DEPARTMENT_FN(p.qual) || REFERENCES_DEPARTMENT_FN(p.withCheck),
      ),
    )
    push(
      'throwaway department_owned table has an index leading with department_id',
      await leadingIndexColumn(client, 'app', deptName, 'department_id'),
    )

    const userRls = await rlsState(client, 'app', userName)
    push('throwaway user_owned table has RLS enabled and forced', userRls.enabled && userRls.forced)
    const userPol = await policies(client, 'app', userName)
    push(
      'throwaway user_owned table has a policy referencing app.current_user_id()',
      userPol.some((p) => REFERENCES_USER_FN(p.qual) || REFERENCES_USER_FN(p.withCheck)),
    )
    push(
      'throwaway user_owned table has no policy mentioning current_actor_role()',
      !userPol.some(
        (p) => REFERENCES_ACTOR_ROLE_FN(p.qual) || REFERENCES_ACTOR_ROLE_FN(p.withCheck),
      ),
    )
  } finally {
    await client.query(dropTableDDL('app', deptName)).catch(() => {})
    await client.query(dropTableDDL('app', userName)).catch(() => {})
  }

  // An unclassified table must fail the gate (the disproof named in the item's handoff), proven here
  // against the real, live table list rather than a fixture.
  const negative = checkTenancyCoverage([...tables, 'app.totally_unclassified_probe_table'])
  push(
    'an unclassified table fails checkTenancyCoverage (the migrate gate would fail too)',
    negative.ok === false && negative.unclassified.includes('app.totally_unclassified_probe_table'),
  )

  return results
}

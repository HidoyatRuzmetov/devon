// Transaction-local tenancy re-pointing for seed modules. `demo.ts` runs every module's `seed()` and
// `reset()` inside one shared `withContext()` transaction under a fixed `demoContext()`
// (`{ userId: null, actorRole: 'super_admin', departmentId: DEMO_DEPARTMENT.id }`). Two kinds of rows
// cannot be written -- or deleted -- under that context as-is:
//   - rows of a *second* demo department (`departments.ts`, `structure.ts`): every department-scoped
//     policy (`migrations/0005_rls.sql`, `0200_structure.sql`, ...) compares `department_id` to
//     `app.current_department_id()`, and there is no super-admin carve-out on the write policies;
//   - owner-only rows (`personal.ts`, `notifications.ts`): `user_id = app.current_user_id()`, no
//     actor-role bypass at all (I-1).
// `withContext` sets every GUC with `set_config(..., true)` -- `SET LOCAL` semantics -- which can be
// re-issued as often as needed inside the still-open transaction. These helpers narrow one GUC to the
// value a statement needs, run it, and restore whatever the GUC held before (not a hard-coded value,
// so nesting `asDepartment` inside `asUser` or vice versa is safe), so no seed module ever leaks a
// borrowed identity into whichever module runs next. `context.ts`'s `assertContextEstablished` only
// ever checks `app.request_id`, which is never touched here.
//
// The whole run stays on the one shared connection on purpose: a *second*, independently-opened
// `withContext()` would be a different Postgres session and could never see this transaction's own
// still-uncommitted inserts (MVCC visibility does not cross sessions) -- exactly the
// `memberships_user_id_fkey` violation `departments.ts` used to throw.
import { sql } from 'drizzle-orm'
import type { Tx } from '../context.js'

type GucName = 'app.department_id' | 'app.user_id'

async function withGuc<T>(tx: Tx, name: GucName, value: string, fn: () => Promise<T>): Promise<T> {
  const previous = await tx.raw<{ v: string | null }>(
    sql`select current_setting(${name}, true) as v`,
  )
  const restoreTo = previous[0]?.v ?? ''
  await tx.raw(sql`select set_config(${name}, ${value}, true)`)
  // No try/finally around the restore: if `fn` throws, Postgres has already aborted the transaction
  // (every subsequent statement, the restore included, would fail with 25P02 and *mask* the real
  // error), and `withContext` rolls the whole thing back anyway -- so there is nothing to restore. The
  // restore only matters on the success path, when the shared transaction keeps being used afterwards.
  const result = await fn()
  await tx.raw(sql`select set_config(${name}, ${restoreTo}, true)`)
  return result
}

/** Runs `fn` with `app.department_id` pointed at `departmentId`, then restores the previous value. */
export function asDepartment<T>(tx: Tx, departmentId: string, fn: () => Promise<T>): Promise<T> {
  return withGuc(tx, 'app.department_id', departmentId, fn)
}

/** Runs `fn` with `app.user_id` pointed at `userId`, then restores the previous value. */
export function asUser<T>(tx: Tx, userId: string, fn: () => Promise<T>): Promise<T> {
  return withGuc(tx, 'app.user_id', userId, fn)
}

// EPIC-013 demo seed: two extra departments the super admin console has something real to show
// against -- one paused, one archived -- neither with members (a bare admin-only bookkeeping row is
// realistic for "a department nobody has used since it was paused/archived", and skipping membership
// avoids reaching into `accounts.ts`'s `EXTRA_USERS` index space another module already fully claims).
// `order: 900` -- last: this module only adds console-facing rows, nothing anything else depends on.
//
// Same GUC-flip as `departments.ts` (order 20) for the same reason: writing a *new* department's row
// under `app.departments`'s RLS `with check` requires `app.department_id` to equal that row's own id
// for the instant of the write, then restored to `DEMO_DEPARTMENT.id` so every module after this one
// (there are none, at order 900, but the pattern is load-bearing regardless) sees the original scope.
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '../../context.js'
import * as schema from '../../schema/index.js'
import { DEMO_DEPARTMENT } from '../fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'
import { asDepartment } from '../scope.js'

export const order = 900

type ShowcaseDept = {
  key: string
  name: string
  slug: string
  status: 'paused_by_admin' | 'archived'
  description: string
}

const SHOWCASE_DEPARTMENTS: ShowcaseDept[] = [
  {
    key: 'department.archive_admin',
    name: 'Arxiv boshqarmasi',
    slug: 'arxiv-boshqarmasi',
    status: 'paused_by_admin',
    description:
      "Qayta tashkil etilishi kutilmoqda -- super administrator tomonidan vaqtincha to'xtatilgan.",
  },
  {
    key: 'department.licensing_old',
    name: 'Litsenziyalash boshqarmasi (eski)',
    slug: 'litsenziyalash-boshqarmasi-eski',
    status: 'archived',
    description: 'Yangi boshqarmaga birlashtirilgan, arxivlangan.',
  },
]

/**
 * Writes on the *shared* `tx` (same connection/transaction as every other seed module -- file
 * header), flipping the `app.department_id` GUC to this new department's own id for the instant of
 * the write and restoring it before returning, exactly like `departments.ts`'s `createDepartmentWithHead`
 * (order 20) does for the identical reason. Sequential in the caller (never `Promise.all`), one
 * `await` per department, so two inserts can never interleave their GUC flips against each other.
 */
async function seedShowcaseDepartment(tx: Tx, spec: ShowcaseDept): Promise<number> {
  const departmentId = demoId(spec.key)
  await tx.raw(sql`select set_config('app.department_id', ${departmentId}, true)`)
  try {
    const inserted = await tx.drizzle
      .insert(schema.departments)
      .values({
        id: departmentId,
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        localeDefault: 'uz-Latn',
        status: spec.status,
      })
      .onConflictDoNothing()
      .returning({ id: schema.departments.id })

    if (inserted.length > 0) {
      tx.audit({
        action:
          spec.status === 'archived' ? 'admin.department.archived' : 'admin.department.paused',
        subjectType: 'department',
        subjectId: departmentId,
        departmentId,
        after: { status: spec.status, reason: 'demo_seed' },
      })
    }
    return inserted.length
  } finally {
    await tx.raw(sql`select set_config('app.department_id', ${DEMO_DEPARTMENT.id}, true)`)
  }
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  for (const spec of SHOWCASE_DEPARTMENTS) {
    rows += await seedShowcaseDepartment(tx, spec)
  }

  return rows
}

/**
 * Blitz integration fix: this module shipped `seed()` but no `reset()` -- `seed:reset --demo` only
 * calls a module's `reset()` when one exists, so these two showcase departments were never cleaned up
 * and `app.departments` stayed at 2 rows after a reset that should have zeroed it (reproduced end to
 * end against a fresh Testcontainers Postgres, `test:seed-idempotence` -- the same class of gap
 * `analytics.ts`/`pages.ts`/`ai.ts` had for their own tables, found fixing this same run). Same
 * GUC-flip `seedShowcaseDepartment` above already uses for the insert, mirrored here for the delete:
 * `departments_write`'s RLS needs `app.department_id` to equal the row's own id for the instant of the
 * write (`scope.ts`'s `asDepartment`, the same helper `departments.ts`'s `resetDepartment` uses).
 * Neither showcase department has members (this file's header), so there is no `memberships` row to
 * delete first the way `departments.ts`'s own `resetDepartment` needs to.
 */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  for (const spec of SHOWCASE_DEPARTMENTS) {
    const departmentId = demoId(spec.key)
    rows += await asDepartment(tx, departmentId, async () => {
      const deleted = await tx.drizzle
        .delete(schema.departments)
        .where(eq(schema.departments.id, departmentId))
        .returning({ id: schema.departments.id })
      return deleted.length
    })
  }

  return rows
}

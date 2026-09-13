// The demo seed itself (item handoff, AC-1, AC-2, ADR-013): `pg_advisory_lock(hashtext('devon.seed'))`
// for the run's duration + `app.seed_runs(name)` primary key + deterministic UUIDv5 ids + `on conflict
// do nothing` gives exact idempotence. Goes through the *production* `withContext()` wrapper (never a
// bespoke connection), so the demo rows are written exactly as a real request would write them --
// including the same RLS policies and the same audited-write path (I-1, I-5).
import { createHash } from 'node:crypto'
import { sql, inArray } from 'drizzle-orm'
import { Client } from 'pg'
import { withContext, type RequestContext } from '../context.js'
import * as schema from '../schema/index.js'
import { DEMO_DELETE_ORDER, DEMO_DEPARTMENT, computeDemoChecksum } from './fixtures.js'
import { assertSeedAllowed, type SeedEnv } from './guard.js'
import { loadSeedModules, type LoadedSeedModule } from './module-loader.js'
import { sweepDemoResidue, type DemoScope } from './reset-sweep.js'

/**
 * Every department and every user the demo seed is responsible for: the foundation's
 * (`DEMO_DELETE_ORDER`) plus whatever each module declares it creates. This is the scope
 * `reset-sweep.ts` clears of rows nobody named -- see that file's header for why a reset expressed
 * as "delete the rows I wrote" could never survive a box anyone had demonstrated from.
 */
function demoScopeOf(modules: readonly LoadedSeedModule[]): DemoScope {
  const departmentIds = new Set<string>([DEMO_DEPARTMENT.id])
  const userIds = new Set<string>(DEMO_DELETE_ORDER[2].ids)
  for (const mod of modules) {
    for (const id of mod.scope?.departmentIds ?? []) departmentIds.add(id)
    for (const id of mod.scope?.userIds ?? []) userIds.add(id)
  }
  return { departmentIds: [...departmentIds], userIds: [...userIds] }
}

export const SEED_NAME = 'demo'
const ADVISORY_LOCK_NAME = 'devon.seed'

export type SeedDemoOutcome = {
  applied: boolean
  rowsWritten: number
  checksum: string
  message: string
}

export type ResetDemoOutcome = {
  deleted: boolean
  rowsDeleted: number
  message: string
}

function requireDatabaseUrl(env: SeedEnv & { DATABASE_URL?: string }): string {
  const url = env.DATABASE_URL
  if (!url) throw new Error('@devon/db seed: DATABASE_URL is not set')
  return url
}

/** Holds the session-level advisory lock named in the handoff for the duration of `fn`, on a
 * connection dedicated to the lock alone (the work inside `fn` opens its own connections through
 * `withContext`'s pool -- the lock only needs to be held by *some* connection to serialise concurrent
 * seed runs against each other; it does not need to be the same connection that does the writes). */
async function withSeedLock<T>(databaseUrl: string, fn: () => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [ADVISORY_LOCK_NAME])
    try {
      return await fn()
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_NAME])
    }
  } finally {
    await client.end()
  }
}

function demoContext(requestId: string, userAgent: string): RequestContext {
  return {
    requestId,
    userId: null,
    actorRole: 'super_admin',
    departmentId: DEMO_DEPARTMENT.id,
    // v1.1: `app.current_department_role()` (migration 0904) is what the head-only write policies on
    // `app.goals`, `app.work_templates` and `app.automation_rules` compare against -- and unlike every
    // v1.0 policy they carry no `current_actor_role() = 'super_admin'` carve-out, by design (SPEC §2:
    // a super admin's lens is read-only). Leaving this unset made every one of those inserts silently
    // match zero rows, which is how the demo department ended up with no goal, no template and no
    // automation rule. The seed IS the department's head for the rows it writes.
    departmentRole: 'head',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent,
  }
}

/**
 * The recorded-run fingerprint. `computeDemoChecksum()` covers the *fixtures*; this adds the set of
 * seed modules that will run, because adding a module is exactly the change that must make an
 * already-seeded database seed again.
 *
 * Before this, `runSeedDemo` short-circuited on the mere existence of a `seed_runs` row, so every
 * machine that had ever run `pnpm start --demo` kept a database with none of v1.1's demo content in
 * it -- no custom fields, no estimates, no goal, no templates, no automation rule -- and the only
 * cure was knowing to run `seed:reset --demo` first. Every module is `on conflict do nothing`
 * (MODULE-GUIDE.md "DB: seeds") and that is asserted by `test/seed.idempotence.test.ts`, so re-running
 * the whole set writes exactly the rows that are missing and nothing else.
 */
function runFingerprint(moduleNames: readonly string[]): string {
  return createHash('sha256')
    .update(`${computeDemoChecksum()}|${[...moduleNames].sort().join(',')}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * `pnpm --filter @devon/db seed:demo` (AC-1, AC-2). Refuses via `assertSeedAllowed` before opening a
 * single connection. Idempotent: a second call writes zero rows and reports the checksum recorded by
 * the first run; on success, sets `app.instance_settings.is_demo = true` -- the only thing that makes
 * the demo chip render.
 */
export async function runSeedDemo(
  env: SeedEnv & { DATABASE_URL?: string } = process.env,
): Promise<SeedDemoOutcome> {
  assertSeedAllowed(env)
  const databaseUrl = requireDatabaseUrl(env)
  // Every module under `src/seed/modules/*.ts`, in ascending `order` (MODULE-GUIDE.md "Seeds") --
  // `core.ts` (order 0) writes the department/users/memberships every other module's fixtures
  // reference; this transaction/advisory-lock/checksum wrapper is the only thing that stays here.
  const seedModules = await loadSeedModules()
  const checksum = runFingerprint(seedModules.map((m) => m.name))

  return withSeedLock(databaseUrl, () =>
    withContext(demoContext(`seed-demo-${Date.now()}`, 'devon-seed/demo'), async (tx) => {
      const existing = await tx.raw<{ checksum: string; rows_written: number }>(
        sql`select checksum, rows_written from app.seed_runs where name = ${SEED_NAME}`,
      )
      const already = existing[0]
      if (already && already.checksum === checksum) {
        return {
          applied: false,
          rowsWritten: 0,
          checksum: already.checksum,
          message: `demo seed already applied (checksum ${already.checksum}) -- 0 rows written`,
        }
      }

      // Sequential, not Promise.all: a later module's fixtures can depend on an earlier module having
      // already inserted the row they reference (the exact reason `order` exists).
      let rowsWritten = 0
      for (let i = 0; i < seedModules.length; i += 1) {
        rowsWritten += await seedModules[i]!.seed({ tx })
      }

      await tx.raw(
        sql`update app.instance_settings
            set is_demo = true, updated_at = now(), version = version + 1
            where id = 1`,
      )

      // `do update`, not `do nothing`: on a top-up run (a new module appeared) the recorded
      // fingerprint has to move to the new one, or every subsequent run would top up again.
      await tx.raw(
        sql`insert into app.seed_runs (name, checksum, rows_written)
            values (${SEED_NAME}, ${checksum}, ${rowsWritten})
            on conflict (name) do update
              set checksum = excluded.checksum,
                  rows_written = app.seed_runs.rows_written + excluded.rows_written`,
      )

      tx.audit({
        action: 'seed.demo_applied',
        subjectType: 'seed_run',
        subjectId: SEED_NAME,
        departmentId: DEMO_DEPARTMENT.id,
        after: { checksum, rowsWritten },
      })

      return {
        applied: true,
        rowsWritten,
        checksum,
        message: `demo seed applied (checksum ${checksum}) -- ${rowsWritten} row(s) written`,
      }
    }),
  )
}

/**
 * `pnpm --filter @devon/db seed:reset --demo` (design §5.3). Deletes only rows whose id is inside the
 * demo UUIDv5 namespace and whose `seed_runs.name` matches, then deletes the `seed_runs` row and turns
 * the demo chip back off. Never touches `audit.*` -- `audit.events` has no delete path, by design
 * (I-3/I-5a). Refuses under the same production guard as `seed:demo`.
 *
 * Every seed module's `reset()` runs first, in *descending* `order` -- the exact reverse of
 * `runSeedDemo`'s ascending `seed()` loop, so a module's rows are gone before the rows they point at
 * (an earlier module's users/departments) are deleted -- and only then the foundation rows from
 * `core.ts` (`DEMO_DELETE_ORDER`) go, in the same shared transaction: either everything is reset or
 * nothing is.
 */
export async function runResetDemo(
  env: SeedEnv & { DATABASE_URL?: string } = process.env,
): Promise<ResetDemoOutcome> {
  assertSeedAllowed(env)
  const databaseUrl = requireDatabaseUrl(env)

  return withSeedLock(databaseUrl, () =>
    withContext(demoContext(`seed-reset-${Date.now()}`, 'devon-seed/reset'), async (tx) => {
      const existing = await tx.raw<{ checksum: string }>(
        sql`select checksum from app.seed_runs where name = ${SEED_NAME}`,
      )
      if (!existing[0]) {
        return {
          deleted: false,
          rowsDeleted: 0,
          message: 'demo seed not applied -- nothing to reset',
        }
      }

      // Every module's own rows first, highest `order` first (the reverse of `runSeedDemo`): a later
      // module's rows reference an earlier module's (a card its assignee, a unit its department), so
      // the dependants have to go before what they depend on. Sequential for the same reason
      // `runSeedDemo` is. A module without `reset()` (`core.ts`) contributes nothing here -- its rows
      // are `DEMO_DELETE_ORDER`, deleted below.
      const seedModules = await loadSeedModules()

      // First, everything that belongs to the demo scope whoever wrote it: the fill requests a head
      // actually sent, the analytics day the rollup job wrote, the documents the search indexer
      // wrote, the card a presenter created and the comment somebody left on it, the notification it
      // produced. `reset-sweep.ts` explains why this -- and not deleting three named foreign keys --
      // is the fix.
      //
      // Before the modules, not after: a module deletes its *seeded* parent rows by id (a personal
      // sprint, a field definition, an automation rule), and an app-written child pointing at one of
      // them blocks that delete just as surely as it blocks the department delete at the end. One
      // pass over the whole scope, in child-before-parent order, leaves every module's `reset()`
      // deleting only what is genuinely left -- usually nothing, which is exactly right.
      let moduleRowsDeleted = await sweepDemoResidue(tx, demoScopeOf(seedModules))

      for (let i = seedModules.length - 1; i >= 0; i -= 1) {
        const reset = seedModules[i]!.reset
        if (reset) moduleRowsDeleted += await reset({ tx })
      }

      // Sessions aren't part of `DEMO_DELETE_ORDER` (they're not "demo data" -- a session row is
      // created by a real login against a demo account, not by any seed module), but they still hold
      // an `app.sessions.user_id` FK straight at `app.users`. Logging into a demo account and then
      // running `seed:reset --demo` is the ordinary path (it is exactly how a demo gets reset between
      // presentations), so this must not depend on every such session already having expired --
      // without this delete, `deletedUsers` below fails with `sessions_user_id_fkey`. (Modules that
      // seed users of their own -- `accounts.ts`, `work.ts`, `structure.ts` -- do the same for theirs
      // inside their `reset()`, since every demo account shares `DEMO_PASSWORD` and can be logged into.)
      await tx.drizzle
        .delete(schema.sessions)
        .where(inArray(schema.sessions.userId, [...DEMO_DELETE_ORDER[2].ids]))

      // Same reasoning, same FK shape, for `app.user_security`: `DEMO_SUPER_ADMIN` (package
      // `demo-super-admin`) gets one such row from `core.ts`'s `seed()` (mirroring the real
      // `consumeSetupToken` path), and `user_security.user_id` has no `on delete cascade` back to
      // `app.users` -- deleting the user first would fail `user_security_pkey`'s own FK. `demo.boshliq`/
      // `demo.xodim` never get a row here (no seed module writes one for them), so this is a no-op for
      // those two ids; raw SQL because `user_security` is intentionally not in the typed `schema`
      // barrel (`packages/db/src/schema/accounts.ts`'s own header comment). `in`, not
      // `= any($1::uuid[])`: `notifications/repo.ts`'s `markRead` already documents why the latter
      // fails here (drizzle's `sql` template expands an interpolated array into a parenthesized value
      // list, not a single array-typed bind parameter -- `any()` then tries to cast that `record` to
      // `uuid[]` and errors).
      await tx.raw(
        sql`delete from app.user_security where user_id in ${[...DEMO_DELETE_ORDER[2].ids]}`,
      )

      // Delete order mirrors `DEMO_DELETE_ORDER` (children before parents, FK-safe): memberships,
      // then departments, then users. That constant is the single source of truth for *which* ids are
      // "demo" ids; the queries below just walk it in order.
      const deletedMemberships = await tx.drizzle
        .delete(schema.memberships)
        .where(inArray(schema.memberships.id, [...DEMO_DELETE_ORDER[0].ids]))
        .returning({ id: schema.memberships.id })

      const deletedDepartments = await tx.drizzle
        .delete(schema.departments)
        .where(inArray(schema.departments.id, [...DEMO_DELETE_ORDER[1].ids]))
        .returning({ id: schema.departments.id })

      const deletedUsers = await tx.drizzle
        .delete(schema.users)
        .where(inArray(schema.users.id, [...DEMO_DELETE_ORDER[2].ids]))
        .returning({ id: schema.users.id })

      await tx.raw(sql`delete from app.seed_runs where name = ${SEED_NAME}`)

      await tx.raw(
        sql`update app.instance_settings
            set is_demo = false, updated_at = now(), version = version + 1
            where id = 1`,
      )

      const rowsDeleted =
        moduleRowsDeleted +
        deletedMemberships.length +
        deletedDepartments.length +
        deletedUsers.length

      tx.audit({
        action: 'seed.demo_reset',
        subjectType: 'seed_run',
        subjectId: SEED_NAME,
        departmentId: DEMO_DEPARTMENT.id,
        before: { rowsDeleted },
      })

      return {
        deleted: true,
        rowsDeleted,
        message: `demo seed reset -- ${rowsDeleted} row(s) deleted`,
      }
    }),
  )
}

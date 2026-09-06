// The demo seed itself (item handoff, AC-1, AC-2, ADR-013): `pg_advisory_lock(hashtext('devon.seed'))`
// for the run's duration + `app.seed_runs(name)` primary key + deterministic UUIDv5 ids + `on conflict
// do nothing` gives exact idempotence. Goes through the *production* `withContext()` wrapper (never a
// bespoke connection), so the demo rows are written exactly as a real request would write them --
// including the same RLS policies and the same audited-write path (I-1, I-5).
import { sql, inArray } from 'drizzle-orm'
import { Client } from 'pg'
import { withContext, type RequestContext } from '../context.js'
import * as schema from '../schema/index.js'
import {
  DEMO_DELETE_ORDER,
  DEMO_DEPARTMENT,
  DEMO_MEMBERSHIPS,
  DEMO_USERS,
  computeDemoChecksum,
  demoPasswordHash,
} from './fixtures.js'
import { assertSeedAllowed, type SeedEnv } from './guard.js'

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
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent,
  }
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
  const checksum = computeDemoChecksum()

  return withSeedLock(databaseUrl, () =>
    withContext(demoContext(`seed-demo-${Date.now()}`, 'devon-seed/demo'), async (tx) => {
      const existing = await tx.raw<{ checksum: string; rows_written: number }>(
        sql`select checksum, rows_written from app.seed_runs where name = ${SEED_NAME}`,
      )
      const already = existing[0]
      if (already) {
        return {
          applied: false,
          rowsWritten: 0,
          checksum: already.checksum,
          message: `demo seed already applied (checksum ${already.checksum}) -- 0 rows written`,
        }
      }

      const insertedUsers = await tx.drizzle
        .insert(schema.users)
        .values(
          DEMO_USERS.map((user) => ({
            id: user.id,
            login: user.login,
            passwordHash: demoPasswordHash(user.id),
            givenName: user.givenName,
            familyName: user.familyName,
            title: user.title,
            role: user.role,
            locale: 'uz-Latn' as const,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.users.id })

      const insertedDepartments = await tx.drizzle
        .insert(schema.departments)
        .values({
          id: DEMO_DEPARTMENT.id,
          name: DEMO_DEPARTMENT.name,
          slug: DEMO_DEPARTMENT.slug,
          localeDefault: DEMO_DEPARTMENT.localeDefault,
        })
        .onConflictDoNothing()
        .returning({ id: schema.departments.id })

      const insertedMemberships = await tx.drizzle
        .insert(schema.memberships)
        .values(
          DEMO_MEMBERSHIPS.map((membership) => ({
            id: membership.id,
            departmentId: membership.departmentId,
            userId: membership.userId,
            role: membership.role,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.memberships.id })

      const rowsWritten =
        insertedUsers.length + insertedDepartments.length + insertedMemberships.length

      await tx.raw(
        sql`update app.instance_settings
            set is_demo = true, updated_at = now(), version = version + 1
            where id = 1`,
      )

      await tx.raw(
        sql`insert into app.seed_runs (name, checksum, rows_written)
            values (${SEED_NAME}, ${checksum}, ${rowsWritten})
            on conflict (name) do nothing`,
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
        deletedMemberships.length + deletedDepartments.length + deletedUsers.length

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

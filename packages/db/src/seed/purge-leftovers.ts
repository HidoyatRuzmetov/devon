// v1.1 SPEC §12 / WALKTHROUGH-FINDINGS §6 (item 21): purge the automation leftovers from a demo
// instance.
//
// What this is for. The demo box the CTO tested was polluted with rows no seed module ever wrote:
// "Blitz sinov boshqarmasi" ×2 (heads "Test Blitzov", "Sardorbek Test-Blitzov"), "Sifat nazorati
// boshqarmasi" (head "Kamron Testov"), accounts `@test.blitzov`, `@malika.fototestova`. They came
// from the blitz/e2e workflows driving the *real* API against the dev database -- which is exactly
// how they should have been driven -- and then stayed, visible to the ministry in
// `/admin/departments` and `/admin/accounts`.
//
// So this is deliberately NOT part of `seed:reset --demo`. That command deletes what `seed:demo`
// wrote, and `test/seed.idempotence.test.ts` asserts every `app.*` table returns to its pre-seed row
// count -- a command that also removed rows predating the seed would break that invariant and, worse,
// would make "reset the demo" quietly mean "delete things I did not create".
//
// What it does, and does not do. It **soft-deletes**: `deleted_at = now()`, which is what deletion
// already means everywhere in this product (every list endpoint and every RLS policy filters on it).
// Nothing is dropped, the audit trail is untouched (I-3), and a mistake is reversible with one SQL
// statement. It refuses under the same production guard as every other seed entry point, and it can
// never touch the three demo logins or the demo department -- those are checked by id, not by name.
import { sql } from 'drizzle-orm'
import { withContext } from '../context.js'
import { DEMO_DEPARTMENT, DEMO_USERS } from './fixtures.js'
import { assertSeedAllowed, type SeedEnv } from './guard.js'

/**
 * Name fragments that mark a department as automation debris. Matched case-insensitively against
 * `app.departments.name`. Deliberately a short, checked-in, reviewable list rather than a clever
 * heuristic: a command that deletes by pattern must be readable at a glance by whoever runs it, and
 * a real boshqarma named "Sinov va sifat nazorati boshqarmasi" would be a legitimate department this
 * list must not be allowed to guess at.
 */
export const LEFTOVER_DEPARTMENT_PATTERNS: readonly string[] = [
  'blitz',
  'sinov boshqarmasi',
  'test department',
  'e2e',
]

/** Login fragments that mark an account as automation debris. Matched against `app.users.login`. */
export const LEFTOVER_LOGIN_PATTERNS: readonly string[] = [
  'blitz',
  'test.',
  '.test',
  'testov',
  'testova',
  'fototest',
  'e2e',
]

export type PurgeOutcome = {
  departments: { id: string; name: string }[]
  users: { id: string; login: string }[]
  /** True when `dryRun` was set -- the rows above were found but nothing was written. */
  previewOnly: boolean
}

function likeAny(column: string, patterns: readonly string[]) {
  // One `OR` chain, one query -- never one query per pattern.
  return sql.join(
    patterns.map((p) => sql.raw(`${column} ilike `).append(sql`${`%${p}%`}`)),
    sql` or `,
  )
}

/**
 * Finds (and unless `dryRun`, soft-deletes) every leftover department and account.
 *
 * The demo department and the three demo accounts are excluded **by id**, so no amount of pattern
 * drift can catch them: `demo.boshliq`, `demo.xodim` and `admin.super` are what a demo is for.
 */
export async function runPurgeLeftovers(
  options: { dryRun?: boolean } = {},
  env: SeedEnv & { DATABASE_URL?: string } = process.env,
): Promise<PurgeOutcome> {
  assertSeedAllowed(env)
  const dryRun = options.dryRun === true
  const protectedUserIds = DEMO_USERS.map((u) => u.id)
  const protectedDepartmentId = DEMO_DEPARTMENT.id

  return withContext(
    {
      requestId: `seed-purge-${Date.now()}`,
      userId: null,
      actorRole: 'super_admin',
      departmentId: null,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'devon-seed/purge-leftovers',
    },
    async (tx) => {
      const departments = await tx.raw<{ id: string; name: string }>(sql`
        select id, name from app.departments
        where deleted_at is null
          and id <> ${protectedDepartmentId}
          and (${likeAny('name', LEFTOVER_DEPARTMENT_PATTERNS)})
        order by name
      `)

      const users = await tx.raw<{ id: string; login: string }>(sql`
        select id, login::text as login from app.users
        where deleted_at is null
          and id not in ${protectedUserIds}
          and (${likeAny('login::text', LEFTOVER_LOGIN_PATTERNS)})
        order by login
      `)

      if (dryRun || (departments.length === 0 && users.length === 0)) {
        return { departments, users, previewOnly: dryRun }
      }

      if (departments.length > 0) {
        const ids = departments.map((d) => d.id)
        await tx.raw(sql`
          update app.departments set deleted_at = now(), updated_at = now()
          where id in ${ids}
        `)
        // Their memberships go too, or the people in them keep a department the product says is
        // gone (and `GET /me` would still list it in the switcher).
        await tx.raw(sql`
          update app.memberships set deleted_at = now(), status = 'removed', updated_at = now()
          where department_id in ${ids} and deleted_at is null
        `)
      }

      if (users.length > 0) {
        const ids = users.map((u) => u.id)
        await tx.raw(sql`
          update app.users set deleted_at = now(), status = 'disabled', updated_at = now()
          where id in ${ids}
        `)
        await tx.raw(sql`
          update app.memberships set deleted_at = now(), status = 'removed', updated_at = now()
          where user_id in ${ids} and deleted_at is null
        `)
        // A disabled account must not keep a live session (the same rule every password reset
        // follows).
        await tx.raw(sql`
          update app.sessions set revoked_at = now(), revoked_reason = 'account_purged'
          where user_id in ${ids} and revoked_at is null
        `)
      }

      tx.audit({
        action: 'seed.leftovers_purged',
        subjectType: 'instance',
        subjectId: null,
        after: { departments: departments.length, users: users.length },
      })

      return { departments, users, previewOnly: false }
    },
  )
}

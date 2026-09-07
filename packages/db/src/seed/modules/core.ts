// The foundation seed module (MODULE-GUIDE.md "Seeds"): the one department, one head, one member, and
// (package `demo-super-admin`) the one global `super_admin` account from `fixtures.ts`. `order: 0`
// because every other module's fixtures reference `DEMO_DEPARTMENT`/`DEMO_USERS` by id -- this module
// has to have run first. Moved here verbatim from what used to be inline in `runSeedDemo` (the
// transaction/lock/checksum wrapper itself still lives there); the demo rows and their idempotence
// guarantee (`ON CONFLICT DO NOTHING` against deterministic UUIDv5 ids) are unchanged.
//
// Deliberately the one module without a `reset()`: its rows are exactly `fixtures.ts`'s
// `DEMO_DELETE_ORDER`, which `runResetDemo` deletes itself -- last, after every other module's
// `reset()` has removed the rows that point at these users/department.
import { sql } from 'drizzle-orm'
import * as schema from '../../schema/index.js'
import {
  DEMO_DEPARTMENT,
  DEMO_MEMBERSHIPS,
  DEMO_SUPER_ADMIN,
  DEMO_USERS,
  demoPasswordHash,
} from '../fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 0

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx

  // One hash for every demo user (they all share `DEMO_PASSWORD`, `DEMO_SUPER_ADMIN` included) --
  // computed once, not once per user, since `hash()` (argon2id) is deliberately slow.
  const passwordHash = await demoPasswordHash()

  const insertedUsers = await tx.drizzle
    .insert(schema.users)
    .values(
      DEMO_USERS.map((user) => ({
        id: user.id,
        login: user.login,
        passwordHash,
        givenName: user.givenName,
        familyName: user.familyName,
        title: user.title,
        role: user.role,
        locale: 'uz-Latn' as const,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.users.id })

  // `DEMO_SUPER_ADMIN` (package `demo-super-admin`): `role: 'super_admin'`, no membership row --
  // mirrors exactly what `POST /api/v1/setup/:token` itself writes for a real first super admin
  // (`apps/api/src/db/repo.ts`'s `consumeSetupToken`: the user row, then one `app.user_security` row
  // in the same transaction so 2FA enrolment/lockout tracking has somewhere to write -- `totp_enabled`
  // defaults to `false`, i.e. 2FA off, exactly as that comment requires).
  const insertedSuperAdmin = await tx.drizzle
    .insert(schema.users)
    .values({
      id: DEMO_SUPER_ADMIN.id,
      login: DEMO_SUPER_ADMIN.login,
      passwordHash,
      givenName: DEMO_SUPER_ADMIN.givenName,
      familyName: DEMO_SUPER_ADMIN.familyName,
      title: DEMO_SUPER_ADMIN.title,
      role: 'super_admin',
      locale: 'uz-Latn' as const,
    })
    .onConflictDoNothing()
    .returning({ id: schema.users.id })

  if (insertedSuperAdmin.length > 0) {
    await tx.raw(sql`insert into app.user_security (user_id) values (${DEMO_SUPER_ADMIN.id})`)
  }

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

  return (
    insertedUsers.length +
    insertedSuperAdmin.length +
    insertedDepartments.length +
    insertedMemberships.length
  )
}

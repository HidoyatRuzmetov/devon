// The foundation seed module (MODULE-GUIDE.md "Seeds"): the one department, one head, one member from
// `fixtures.ts`. `order: 0` because every other module's fixtures reference `DEMO_DEPARTMENT`/
// `DEMO_USERS` by id -- this module has to have run first. Moved here verbatim from what used to be
// inline in `runSeedDemo` (the transaction/lock/checksum wrapper itself still lives there); the demo
// rows and their idempotence guarantee (`ON CONFLICT DO NOTHING` against deterministic UUIDv5 ids) are
// unchanged.
import * as schema from '../../schema/index.js'
import { DEMO_DEPARTMENT, DEMO_MEMBERSHIPS, DEMO_USERS, demoPasswordHash } from '../fixtures.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 0

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx

  // One hash for every demo user (they all share `DEMO_PASSWORD`) -- computed once, not once per
  // user, since `hash()` (argon2id) is deliberately slow.
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

  return insertedUsers.length + insertedDepartments.length + insertedMemberships.length
}

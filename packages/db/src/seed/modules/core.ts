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

/** Every Imkoniyatlar switch key, on. Mirrors `FEATURE_KEYS` in `packages/contracts/src/
 * features.ts` -- see the comment at the call site for why it is mirrored rather than imported. */
const DEMO_FEATURES: Readonly<Record<string, boolean>> = Object.freeze({
  custom_fields: true,
  person_fields: true,
  estimates: true,
  workload: true,
  dependencies: true,
  recurring: true,
  templates: true,
  goals: true,
  focus_list: true,
  automations: true,
  reminders: true,
})

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
      // v1.1 SPEC 7: "the demo department has them all on". A demo is a tour -- every switch off by
      // default is right for a real boshqarma discovering the product, and wrong for the one
      // instance whose job is to show what the product can do.
      //
      // Written out here rather than imported from `packages/contracts/src/features.ts`'s
      // `allFeaturesOn()`: `@devon/db` deliberately does not depend on `@devon/contracts` (the same
      // one-way rule that makes `context.ts` re-declare the `Role` union). The registry stays the
      // single source of truth for what a switch *means* and what its default is; this is the demo
      // instance saying "yes" to each, and `packages/contracts/test/unit/features.test.ts` asserts
      // the two key sets still agree.
      features: DEMO_FEATURES,
      // SPEC 2.2: new departments now require approval to join (migration 0102 flipped the default),
      // but the demo department deliberately does not -- a demo join has to stay one step. Set
      // explicitly, in both directions, so neither default can quietly change what a demo does.
      joinRequiresApproval: false,
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

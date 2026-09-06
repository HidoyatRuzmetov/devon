// Structure demo seed (MODULE-GUIDE.md "DB: seeds", EPIC-003). Two scenarios, per this item's task
// list:
//   1. A brand-new department, "Axborot-tahlil va ijro intizomi boshqarmasi", with two top-level
//      bo'limlar and one sub-bo'lim (three levels total, one of them with both a head and a deputy)
//      -- proves the org chart at real depth.
//   2. The foundation's own demo department ("Raqamli xizmatlar boshqarmasi", seeded by `core.ts`)
//      gets two flat bo'limlar and *no* unit heads at all -- proves the org chart looks complete with
//      zero unit heads (design.md §2.3), using the two accounts already documented in
//      MODULE-GUIDE.md ("Running the app") so `demo.boshliq`/`demo.xodim` see it immediately on login.
// `fixtures.ts` is core's file, not this module's (MODULE-GUIDE.md's touches list) -- this module
// creates its own department and users the same way `core.ts` creates the foundation's, with its own
// `demoId(...)` namespace, and never edits `fixtures.ts`/`DEMO_DELETE_ORDER`.
import { sql } from 'drizzle-orm'
import * as schema from '../../schema/index.js'
import * as structureSchema from '../../schema/structure.js'
import { DEMO_DEPARTMENT, DEMO_USERS, demoPasswordHash } from '../fixtures.js'
import { demoId } from '../ids.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 100 // after core.ts (0)

const ATI_DEPARTMENT_ID = demoId('structure.department.ati')

const ATI_USERS = [
  {
    id: demoId('structure.user.rahimov'),
    login: 'demo.rahimov',
    givenName: 'Bekzod',
    familyName: 'Rahimov',
    patronymic: 'Shuhrat oʻgʻli',
    title: 'Boshqarma boshligʻi',
    membershipRole: 'head' as const,
  },
  {
    id: demoId('structure.user.tosheva'),
    login: 'demo.tosheva',
    givenName: 'Madina',
    familyName: 'Tosheva',
    patronymic: 'Alisher qizi',
    title: 'Boʻlim boshligʻi',
    membershipRole: 'member' as const,
  },
  {
    id: demoId('structure.user.nazarov'),
    login: 'demo.nazarov',
    givenName: 'Javlon',
    familyName: 'Nazarov',
    patronymic: 'Odil oʻgʻli',
    title: 'Yetakchi mutaxassis',
    membershipRole: 'member' as const,
  },
  {
    id: demoId('structure.user.yoqubova'),
    login: 'demo.yoqubova',
    givenName: 'Sevinch',
    familyName: 'Yoqubova',
    patronymic: 'Farrux qizi',
    title: 'Mutaxassis',
    membershipRole: 'member' as const,
  },
  {
    id: demoId('structure.user.qodirov'),
    login: 'demo.qodirov',
    givenName: 'Otabek',
    familyName: 'Qodirov',
    patronymic: 'Shuhrat oʻgʻli',
    title: 'Mutaxassis',
    membershipRole: 'member' as const,
  },
  {
    id: demoId('structure.user.ergasheva'),
    login: 'demo.ergasheva',
    givenName: 'Zarina',
    familyName: 'Ergasheva',
    patronymic: 'Bahodir qizi',
    title: 'Boʻlim boshligʻi',
    membershipRole: 'member' as const,
  },
]

const U_ANALYTICS = demoId('structure.unit.axborot-tahlil')
const U_MONITORING = demoId('structure.unit.monitoring')
const U_EXECUTION = demoId('structure.unit.ijro-intizomi')

const F_SUPPORT = demoId('structure.unit.texnik-yordam')
const F_CONTENT = demoId('structure.unit.kontent')

function path(...ids: string[]): string {
  return `/${ids.join('/')}/`
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const passwordHash = await demoPasswordHash()

  const insertedUsers = await tx.drizzle
    .insert(schema.users)
    .values(
      ATI_USERS.map((u) => ({
        id: u.id,
        login: u.login,
        passwordHash,
        givenName: u.givenName,
        familyName: u.familyName,
        patronymic: u.patronymic,
        title: u.title,
        role: 'member' as const,
        locale: 'uz-Latn' as const,
        createdAt: new Date('2026-08-10T07:00:00Z'),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: schema.users.id })

  const rahimov = ATI_USERS[0]!.id
  const tosheva = ATI_USERS[1]!.id
  const nazarov = ATI_USERS[2]!.id
  const yoqubova = ATI_USERS[3]!.id
  const qodirov = ATI_USERS[4]!.id
  const ergasheva = ATI_USERS[5]!.id

  // RLS (`units_scope`/`unit_roles_scope`/`departments`/`memberships`, 0005_rls.sql & 0200_structure.sql)
  // checks every row against the single `app.department_id` GUC live on this connection right now --
  // it cannot straddle two departments in one statement. This module writes into *two* departments
  // (a brand-new "Axborot-tahlil..." department, and the foundation's own demo department from
  // `core.ts`), on the one shared `tx` every seed module runs on (`demo.ts`), so each department's
  // rows must be its own statement, wrapped by flipping the GUC to that department's id and back --
  // exactly like `departments.ts`'s `createDepartmentWithHead` (see that file's header for the fuller
  // explanation of why a fresh `withContext()` here would not work either: MVCC visibility does not
  // cross Postgres sessions, and `core.ts`'s/`accounts.ts`'s users and department for this run are
  // still uncommitted on the *shared* connection alone).
  const atiRowsWritten = await (async () => {
    await tx.raw(sql`select set_config('app.department_id', ${ATI_DEPARTMENT_ID}, true)`)
    try {
      return await seedAtiDepartment()
    } finally {
      await tx.raw(sql`select set_config('app.department_id', ${DEMO_DEPARTMENT.id}, true)`)
    }
  })()

  async function seedAtiDepartment(): Promise<number> {
    const insertedDepartments = await tx.drizzle
      .insert(schema.departments)
      .values({
        id: ATI_DEPARTMENT_ID,
        name: 'Axborot-tahlil va ijro intizomi boshqarmasi',
        slug: 'axborot-tahlil-va-ijro',
        localeDefault: 'uz-Latn',
        createdAt: new Date('2026-08-10T07:00:00Z'),
      })
      .onConflictDoNothing()
      .returning({ id: schema.departments.id })

    const insertedMemberships = await tx.drizzle
      .insert(schema.memberships)
      .values(
        ATI_USERS.map((u) => ({
          id: demoId(`structure.membership.${u.login}`),
          departmentId: ATI_DEPARTMENT_ID,
          userId: u.id,
          role: u.membershipRole,
          joinedAt: new Date('2026-08-10T07:00:00Z'),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.memberships.id })

    const insertedUnits = await tx.drizzle
      .insert(structureSchema.units)
      .values([
        {
          id: U_ANALYTICS,
          departmentId: ATI_DEPARTMENT_ID,
          parentUnitId: null,
          name: 'Axborot-tahlil boʻlimi',
          colour: 6,
          sort: 0,
          path: path(U_ANALYTICS),
          createdBy: rahimov,
          createdAt: new Date('2026-08-11T08:00:00Z'),
        },
        {
          id: U_MONITORING,
          departmentId: ATI_DEPARTMENT_ID,
          parentUnitId: U_ANALYTICS,
          name: 'Monitoring guruhi',
          colour: 5,
          sort: 0,
          path: path(U_ANALYTICS, U_MONITORING),
          createdBy: tosheva,
          createdAt: new Date('2026-08-12T09:30:00Z'),
        },
        {
          id: U_EXECUTION,
          departmentId: ATI_DEPARTMENT_ID,
          parentUnitId: null,
          name: 'Ijro intizomi boʻlimi',
          colour: 2,
          sort: 1,
          path: path(U_EXECUTION),
          createdBy: rahimov,
          createdAt: new Date('2026-08-11T08:05:00Z'),
        },
      ])
      .onConflictDoNothing()
      .returning({ id: structureSchema.units.id })

    const insertedUnitRoles = await tx.drizzle
      .insert(structureSchema.unitRoles)
      .values([
        // Self-assigned (assignedBy === userId): Madina claims headship of Axborot-tahlil bo'limi.
        {
          id: demoId('structure.unit-role.tosheva-head'),
          departmentId: ATI_DEPARTMENT_ID,
          unitId: U_ANALYTICS,
          userId: tosheva,
          role: 'head',
          assignedBy: tosheva,
          assignedAt: new Date('2026-08-12T09:00:00Z'),
        },
        {
          id: demoId('structure.unit-role.nazarov-deputy'),
          departmentId: ATI_DEPARTMENT_ID,
          unitId: U_ANALYTICS,
          userId: nazarov,
          role: 'deputy',
          assignedBy: tosheva,
          assignedAt: new Date('2026-08-13T10:00:00Z'),
        },
        // Self-assigned into the sub-bo'lim, as a plain member.
        {
          id: demoId('structure.unit-role.qodirov-member'),
          departmentId: ATI_DEPARTMENT_ID,
          unitId: U_MONITORING,
          userId: qodirov,
          role: 'member',
          assignedBy: qodirov,
          assignedAt: new Date('2026-08-14T11:00:00Z'),
        },
        // Department head assigns Zarina as head of the second bo'lim (design.md: "head can assign
        // others").
        {
          id: demoId('structure.unit-role.ergasheva-head'),
          departmentId: ATI_DEPARTMENT_ID,
          unitId: U_EXECUTION,
          userId: ergasheva,
          role: 'head',
          assignedBy: rahimov,
          assignedAt: new Date('2026-08-15T12:00:00Z'),
        },
        {
          id: demoId('structure.unit-role.yoqubova-member'),
          departmentId: ATI_DEPARTMENT_ID,
          unitId: U_EXECUTION,
          userId: yoqubova,
          role: 'member',
          assignedBy: yoqubova,
          assignedAt: new Date('2026-08-16T13:00:00Z'),
        },
      ])
      .onConflictDoNothing()
      .returning({ id: structureSchema.unitRoles.id })

    return (
      insertedDepartments.length +
      insertedMemberships.length +
      insertedUnits.length +
      insertedUnitRoles.length
    )
  }

  // The flat department (foundation's own demo department): two sibling bo'limlar, deliberately zero
  // unit-head assignments -- proves the org chart renders a complete, headless department too. GUC is
  // already back to `DEMO_DEPARTMENT.id` from the `finally` above.
  const insertedFlatUnits = await tx.drizzle
    .insert(structureSchema.units)
    .values([
      {
        id: F_SUPPORT,
        departmentId: DEMO_DEPARTMENT.id,
        parentUnitId: null,
        name: 'Texnik yordam',
        colour: 4,
        sort: 0,
        path: path(F_SUPPORT),
        createdBy: DEMO_USERS[0]!.id,
        createdAt: new Date('2026-09-01T06:00:00Z'),
      },
      {
        id: F_CONTENT,
        departmentId: DEMO_DEPARTMENT.id,
        parentUnitId: null,
        name: 'Kontent',
        colour: 1,
        sort: 1,
        path: path(F_CONTENT),
        createdBy: DEMO_USERS[0]!.id,
        createdAt: new Date('2026-09-01T06:05:00Z'),
      },
    ])
    .onConflictDoNothing()
    .returning({ id: structureSchema.units.id })

  // Flat department: `demo.xodim` self-assigns into "Kontent" as a plain member -- no head, by
  // design, to prove the org chart renders a headless bo'lim correctly. `demo.boshliq` is left
  // unassigned to any unit, to prove the People page's "unassigned" bucket too.
  const insertedFlatUnitRoles = await tx.drizzle
    .insert(structureSchema.unitRoles)
    .values([
      {
        id: demoId('structure.unit-role.xodim-member'),
        departmentId: DEMO_DEPARTMENT.id,
        unitId: F_CONTENT,
        userId: DEMO_USERS[1]!.id,
        role: 'member',
        assignedBy: DEMO_USERS[1]!.id,
        assignedAt: new Date('2026-09-02T07:00:00Z'),
      },
    ])
    .onConflictDoNothing()
    .returning({ id: structureSchema.unitRoles.id })

  return (
    insertedUsers.length + atiRowsWritten + insertedFlatUnits.length + insertedFlatUnitRoles.length
  )
}

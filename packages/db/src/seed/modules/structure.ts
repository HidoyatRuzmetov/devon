// Structure demo seed (MODULE-GUIDE.md "DB: seeds", EPIC-003). Two scenarios, per this item's task
// list:
//   1. A brand-new department, "Axborot-tahlil va ijro intizomi boshqarmasi", with two top-level
//      bo'limlar and one sub-bo'lim (three levels total, one of them with both a head and a deputy)
//      -- proves the org chart at real depth.
//   2. The demo department itself ("Raqamli xizmatlar boshqarmasi", seeded by `core.ts`) gets the
//      three flat bo'limlar of `work-fixtures.ts`'s `DEMO_UNITS`, every member placed in one of them,
//      two boʻlim boshligʻi and one deputy as real `unit_roles` -- and one bo'lim left deliberately
//      headless, which still proves the org chart looks complete with no unit head (design.md §2.3)
//      while the department around it reads like a real boshqarma rather than two empty boxes.
//      The boshqarma boshligʻi belongs to no bo'lim, so the People page's "unassigned" bucket is
//      populated too.
// `fixtures.ts` is core's file, not this module's (MODULE-GUIDE.md's touches list) -- this module
// creates its own department and users the same way `core.ts` creates the foundation's, with its own
// `demoId(...)` namespace, and never edits `fixtures.ts`/`DEMO_DELETE_ORDER`.
//
// The rows this module writes are declared once, as module-level constants, so `seed()` and `reset()`
// name exactly the same ids. Scenario 1's rows live in a second department: `units_scope`/
// `unit_roles_scope`/`memberships_write`/`departments_write` all compare `department_id` (or `id`) to
// `app.current_department_id()`, which `demo.ts`'s shared transaction leaves pointed at
// `DEMO_DEPARTMENT` -- so those rows are written and deleted under `scope.ts`'s `asDepartment`.
import { inArray, sql } from 'drizzle-orm'
import * as schema from '../../schema/index.js'
import * as structureSchema from '../../schema/structure.js'
import { DEMO_DEPARTMENT, DEMO_USERS, demoPasswordHash } from '../fixtures.js'
import {
  ALL_WORK_MEMBER_IDS,
  DEMO_UNITS,
  NEWCOMER_INDEX,
  NEWCOMER_JOINED_AT,
  unitIdFor,
} from '../work-fixtures.js'
import { demoId } from '../ids.js'
import { asDepartment } from '../scope.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 100 // after core.ts (0) and work.ts (90, this module's unit-role users)

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

const ATI_MEMBERSHIP_ID = (login: string): string => demoId(`structure.membership.${login}`)

const U_ANALYTICS = demoId('structure.unit.axborot-tahlil')
const U_MONITORING = demoId('structure.unit.monitoring')
const U_EXECUTION = demoId('structure.unit.ijro-intizomi')

function path(...ids: string[]): string {
  return `/${ids.join('/')}/`
}

const rahimov = ATI_USERS[0]!.id
const tosheva = ATI_USERS[1]!.id
const nazarov = ATI_USERS[2]!.id
const yoqubova = ATI_USERS[3]!.id
const qodirov = ATI_USERS[4]!.id
const ergasheva = ATI_USERS[5]!.id

type NewUnit = typeof structureSchema.units.$inferInsert
type NewUnitRole = typeof structureSchema.unitRoles.$inferInsert

const UNIT_ROWS: NewUnit[] = [
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
  // The demo department: three sibling bo'limlar, from `work-fixtures.ts`'s one cast list so the
  // board, the People page and the org chart can never disagree about who sits where.
  ...DEMO_UNITS.map((unit, i) => ({
    id: unitIdFor(unit.key),
    departmentId: DEMO_DEPARTMENT.id,
    parentUnitId: null,
    name: unit.name,
    colour: unit.colour,
    sort: i,
    path: path(unitIdFor(unit.key)),
    createdBy: DEMO_USERS[0]!.id,
    createdAt: new Date(`2026-06-0${i + 1}T06:00:00Z`),
  })),
]

const UNIT_ROLE_ROWS: NewUnitRole[] = [
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
  // The demo department: everybody is placed. Two boʻlim boshligʻi and one oʻrinbosar are appointed
  // by the boshqarma boshligʻi; plain members self-assign, which is what the app itself lets them do.
  // "Devonxona va huquq boʻlimi" is left without a head on purpose -- a bo'lim between appointments
  // is the normal state of a real department, and the org chart still has to look finished
  // (design.md §2.3). `demo.boshliq` is in no bo'lim at all, which populates the People page's
  // "unassigned" bucket.
  ...DEMO_UNITS.flatMap((unit) => {
    const unitId = unitIdFor(unit.key)
    const rows: NewUnitRole[] = []
    if (unit.headIndex !== null) {
      rows.push({
        id: demoId(`structure.unit-role.${unit.key}.head`),
        departmentId: DEMO_DEPARTMENT.id,
        unitId,
        userId: ALL_WORK_MEMBER_IDS[unit.headIndex]!,
        role: 'head',
        assignedBy: DEMO_USERS[0]!.id,
        assignedAt: new Date('2026-06-15T06:00:00Z'),
      })
    }
    if (unit.deputyIndex !== undefined) {
      rows.push({
        id: demoId(`structure.unit-role.${unit.key}.deputy`),
        departmentId: DEMO_DEPARTMENT.id,
        unitId,
        userId: ALL_WORK_MEMBER_IDS[unit.deputyIndex]!,
        role: 'deputy',
        assignedBy: DEMO_USERS[0]!.id,
        assignedAt: new Date('2026-06-16T06:00:00Z'),
      })
    }
    for (const memberIndex of unit.memberIndexes) {
      rows.push({
        id: demoId(`structure.unit-role.${unit.key}.member.${memberIndex}`),
        departmentId: DEMO_DEPARTMENT.id,
        unitId,
        userId: ALL_WORK_MEMBER_IDS[memberIndex]!,
        role: 'member',
        assignedBy: ALL_WORK_MEMBER_IDS[memberIndex]!,
        // The newcomer cannot have been placed in a bo'lim before she joined.
        assignedAt:
          memberIndex === NEWCOMER_INDEX ? NEWCOMER_JOINED_AT : new Date('2026-06-17T06:00:00Z'),
      })
    }
    return rows
  }),
]

const idsIn = (
  rows: ReadonlyArray<{ id?: string | undefined; departmentId: string }>,
  departmentId: string,
): string[] => rows.filter((r) => r.departmentId === departmentId).map((r) => r.id!)

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  const passwordHash = await demoPasswordHash()

  // `app.users` carries no RLS -- written under the shared context as-is.
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

  // Scenario 1: everything inside the ATI department, under its own GUC.
  const atiRows = await asDepartment(tx, ATI_DEPARTMENT_ID, async () => {
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
          id: ATI_MEMBERSHIP_ID(u.login),
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
      .values(UNIT_ROWS.filter((u) => u.departmentId === ATI_DEPARTMENT_ID))
      .onConflictDoNothing()
      .returning({ id: structureSchema.units.id })

    const insertedUnitRoles = await tx.drizzle
      .insert(structureSchema.unitRoles)
      .values(UNIT_ROLE_ROWS.filter((r) => r.departmentId === ATI_DEPARTMENT_ID))
      .onConflictDoNothing()
      .returning({ id: structureSchema.unitRoles.id })

    return (
      insertedDepartments.length +
      insertedMemberships.length +
      insertedUnits.length +
      insertedUnitRoles.length
    )
  })

  // Scenario 2: the flat department is `DEMO_DEPARTMENT` -- the shared context already matches it.
  const insertedFlatUnits = await tx.drizzle
    .insert(structureSchema.units)
    .values(UNIT_ROWS.filter((u) => u.departmentId === DEMO_DEPARTMENT.id))
    .onConflictDoNothing()
    .returning({ id: structureSchema.units.id })

  const insertedFlatUnitRoles = await tx.drizzle
    .insert(structureSchema.unitRoles)
    .values(UNIT_ROLE_ROWS.filter((r) => r.departmentId === DEMO_DEPARTMENT.id))
    .onConflictDoNothing()
    .returning({ id: structureSchema.unitRoles.id })

  return insertedUsers.length + atiRows + insertedFlatUnits.length + insertedFlatUnitRoles.length
}

/** Reverse of `seed()`: unit roles, units, memberships, the ATI department, then its users. A parent
 * unit and its sub-unit go in one statement: `units_parent_unit_id_fkey` is a plain (non-deferrable,
 * NO ACTION) constraint, and Postgres checks those at the end of the statement, when both rows are
 * already gone. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx

  // Scenario 2 first (nothing depends on it either way; keeps the walk the exact reverse of `seed()`).
  const deletedFlatUnitRoles = await tx.drizzle
    .delete(structureSchema.unitRoles)
    .where(inArray(structureSchema.unitRoles.id, idsIn(UNIT_ROLE_ROWS, DEMO_DEPARTMENT.id)))
    .returning({ id: structureSchema.unitRoles.id })

  const deletedFlatUnits = await tx.drizzle
    .delete(structureSchema.units)
    .where(inArray(structureSchema.units.id, idsIn(UNIT_ROWS, DEMO_DEPARTMENT.id)))
    .returning({ id: structureSchema.units.id })

  const atiRows = await asDepartment(tx, ATI_DEPARTMENT_ID, async () => {
    const deletedUnitRoles = await tx.drizzle
      .delete(structureSchema.unitRoles)
      .where(inArray(structureSchema.unitRoles.id, idsIn(UNIT_ROLE_ROWS, ATI_DEPARTMENT_ID)))
      .returning({ id: structureSchema.unitRoles.id })

    const deletedUnits = await tx.drizzle
      .delete(structureSchema.units)
      .where(inArray(structureSchema.units.id, idsIn(UNIT_ROWS, ATI_DEPARTMENT_ID)))
      .returning({ id: structureSchema.units.id })

    const deletedMemberships = await tx.drizzle
      .delete(schema.memberships)
      .where(
        inArray(
          schema.memberships.id,
          ATI_USERS.map((u) => ATI_MEMBERSHIP_ID(u.login)),
        ),
      )
      .returning({ id: schema.memberships.id })

    // v1.1 critique SEV2 #24, found running the reseed the fix itself asks for. The analytics
    // rollup job writes an `app.analytics_daily` row per department per day; nothing in any seed
    // module names those rows, so nothing deleted them, and `analytics_daily_department_id_fkey`
    // blocked this department delete on every instance where the job had ever run. Exactly the
    // shape `accounts.ts`'s memberships sweep documents: the app wrote rows the seed did not, and
    // the department is about to be gone either way.
    await tx.raw(sql`delete from app.analytics_daily where department_id = ${ATI_DEPARTMENT_ID}`)

    const deletedDepartments = await tx.drizzle
      .delete(schema.departments)
      .where(inArray(schema.departments.id, [ATI_DEPARTMENT_ID]))
      .returning({ id: schema.departments.id })

    return (
      deletedUnitRoles.length +
      deletedUnits.length +
      deletedMemberships.length +
      deletedDepartments.length
    )
  })

  // Every demo account shares `DEMO_PASSWORD` and can be logged into -- sessions first, for the same
  // `sessions_user_id_fkey` reason `demo.ts` gives for the core accounts.
  const userIds = ATI_USERS.map((u) => u.id)
  await tx.drizzle.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds))

  const deletedUsers = await tx.drizzle
    .delete(schema.users)
    .where(inArray(schema.users.id, userIds))
    .returning({ id: schema.users.id })

  return deletedFlatUnitRoles.length + deletedFlatUnits.length + atiRows + deletedUsers.length
}

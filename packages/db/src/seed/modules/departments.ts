// EPIC-002 demo seed: three departments total (the foundation's one from `core.ts` plus two more) and
// one pending `department_requests` row, per this item's brief ("3 departments (one pending request),
// ~40 users"). `order: 20` -- after `accounts.ts` (10), whose `EXTRA_USERS` this module assigns to
// memberships.
//
// RLS on `app.departments`/`app.memberships` requires `department_id = current_setting('app.department_id')`
// on every write (`migrations/0005_rls.sql`) -- the single `tx` this module receives is bound to the
// *existing* demo department's id for the whole seed run (`demo.ts`'s `demoContext()`), so a second and
// third department's rows need that GUC pointed at their own id instead while they're written.
//
// A real approved `POST /departments/requests/:id/approve` request gets this for free: it opens its
// own fresh `withContext()` with the new department's id as the GUC from the start
// (`apps/api/src/modules/departments/repo.ts`'s `approveDepartmentRequest`), because by the time that
// request runs, the department's future head/members were already committed by their own, earlier,
// already-finished requests (registration, join-by-link, ...). This seed run has no such luxury --
// `demo.ts` wraps every module's `seed()` in one shared transaction on one connection specifically so
// a later module can see an earlier module's still-uncommitted inserts (its own header comment: "a
// later module's fixtures can depend on an earlier module having already inserted the row they
// reference"). `accounts.ts` (order 10) inserts this module's head/member users into that same
// uncommitted transaction, so a *second*, independently-opened `withContext()` here -- a different
// pooled connection, hence a different Postgres session -- could never see them: MVCC visibility does
// not cross sessions, committed or not, which is exactly the `memberships_user_id_fkey` violation this
// used to throw. Fix: stay on the one shared `tx` (same connection, same transaction, so it always
// sees the whole run's own prior writes) and flip only the `app.department_id` GUC around each new
// department's writes via `tx.raw(set_config(..., true))`, restoring it before returning so the rest
// of `seed()` (and every module after this one) still sees `DEMO_DEPARTMENT.id`, unchanged.
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { hash } from '@node-rs/argon2'
import type { Tx } from '../../context.js'
import * as schema from '../../schema/index.js'
import { DEMO_DEPARTMENT } from '../fixtures.js'
import { demoId } from '../ids.js'
import { EXTRA_USERS, extraUserId } from './accounts.js'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 20

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // unambiguous: no 0/O, 1/I/L (TECH-SPEC §2.2)

function randomFromAlphabet(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += JOIN_ALPHABET[bytes[i]! % JOIN_ALPHABET.length]
  return out
}

const generateJoinKey = () => randomFromAlphabet(12)
const generateJoinPassword = () => randomFromAlphabet(9)

type NewDeptSpec = {
  key: string
  name: string
  slug: string
  headIndex: number
  memberIndexes: number[]
}

const NEW_DEPARTMENTS: NewDeptSpec[] = [
  {
    key: 'department.hr',
    name: 'Kadrlar boshqarmasi',
    slug: 'kadrlar-boshqarmasi',
    headIndex: 0,
    memberIndexes: Array.from({ length: 12 }, (_, i) => i + 1), // 1..12
  },
  {
    key: 'department.infosec',
    name: 'Axborot xavfsizligi boshqarmasi',
    slug: 'axborot-xavfsizligi-boshqarmasi',
    headIndex: 13,
    memberIndexes: Array.from({ length: 12 }, (_, i) => i + 14), // 14..25
  },
]

const CORE_EXTRA_MEMBER_INDEXES = Array.from({ length: 10 }, (_, i) => i + 26) // 26..35
const PENDING_REQUEST_USER_INDEX = 36

/**
 * Writes on the *shared* `tx` (same connection, same still-open transaction as every other seed
 * module -- see file header): `accounts.ts` (order 10) inserted this department's head/member users
 * into that same transaction, and MVCC visibility does not cross Postgres sessions, so a second,
 * independently-opened connection here could never see those still-uncommitted rows (the
 * `memberships_user_id_fkey` violation this used to throw). Instead we flip the `app.department_id`
 * GUC to this department's id for the duration of these writes -- `SET LOCAL` semantics
 * (`set_config(..., true)`), same transaction, so it does not leak past commit -- and restore it to
 * `DEMO_DEPARTMENT.id` before returning so the rest of `seed()` (and every module after this one)
 * still sees the original department in scope.
 */
async function createDepartmentWithHead(tx: Tx, spec: NewDeptSpec): Promise<number> {
  const departmentId = demoId(spec.key)
  const headUserId = extraUserId(EXTRA_USERS[spec.headIndex]!)
  const joinKey = generateJoinKey()
  const joinPasswordHash = await hash(generateJoinPassword())

  await tx.raw(sql`select set_config('app.department_id', ${departmentId}, true)`)
  try {
    let rows = 0

    const insertedDept = await tx.drizzle
      .insert(schema.departments)
      .values({ id: departmentId, name: spec.name, slug: spec.slug, localeDefault: 'uz-Latn' })
      .onConflictDoNothing()
      .returning({ id: schema.departments.id })
    rows += insertedDept.length

    if (insertedDept.length > 0) {
      await tx.raw(
        sql`update app.departments
            set join_key = ${joinKey}, join_password_hash = ${joinPasswordHash}, join_requires_approval = false
            where id = ${departmentId}`,
      )
    }

    const membershipRows = [
      { id: demoId(`membership.${spec.key}.head`), userId: headUserId, role: 'head' as const },
      ...spec.memberIndexes.map((idx) => ({
        id: demoId(`membership.${spec.key}.member.${idx}`),
        userId: extraUserId(EXTRA_USERS[idx]!),
        role: 'member' as const,
      })),
    ]
    const insertedMemberships = await tx.drizzle
      .insert(schema.memberships)
      .values(membershipRows.map((m) => ({ ...m, departmentId })))
      .onConflictDoNothing()
      .returning({ id: schema.memberships.id })
    rows += insertedMemberships.length

    tx.audit({
      action: 'departments.demo_seeded',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: { name: spec.name, joinKey },
    })

    return rows
  } finally {
    await tx.raw(sql`select set_config('app.department_id', ${DEMO_DEPARTMENT.id}, true)`)
  }
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  // The two new departments each need their own transaction (see file header) -- sequential, not
  // Promise.all, so a duplicate-slug race between them can never happen even though their ids differ.
  for (const spec of NEW_DEPARTMENTS) {
    rows += await createDepartmentWithHead(tx, spec)
  }

  // The existing demo department (core.ts, order 0) gets its own invite fields via the shared `tx`,
  // whose GUC already matches `DEMO_DEPARTMENT.id`.
  const corePasswordHash = await hash(generateJoinPassword())
  const updatedCore = await tx.raw<{ id: string }>(
    sql`update app.departments
        set join_key = coalesce(join_key, ${generateJoinKey()}),
            join_password_hash = coalesce(join_password_hash, ${corePasswordHash})
        where id = ${DEMO_DEPARTMENT.id} and join_key is null
        returning id`,
  )
  rows += updatedCore.length

  // Ten more members join the existing demo department.
  const coreMemberships = CORE_EXTRA_MEMBER_INDEXES.map((idx) => ({
    id: demoId(`membership.core.member.${idx}`),
    departmentId: DEMO_DEPARTMENT.id,
    userId: extraUserId(EXTRA_USERS[idx]!),
    role: 'member' as const,
  }))
  const insertedCoreMemberships = await tx.drizzle
    .insert(schema.memberships)
    .values(coreMemberships)
    .onConflictDoNothing()
    .returning({ id: schema.memberships.id })
  rows += insertedCoreMemberships.length

  // One pending department creation request (TECH-SPEC §2.2), from a user who belongs to no
  // department yet -- the "Litsenziyalash boshqarmasi" (licensing) request the super admin's approval
  // queue demo shows.
  const requester = EXTRA_USERS[PENDING_REQUEST_USER_INDEX]!
  const requesterUserId = extraUserId(requester)
  const requestId = demoId('department_request.licensing')
  const units = JSON.stringify([
    { name: 'Litsenziya nazorati', colour: '#2563eb' },
    { name: "Ruxsatnomalar bo'limi", colour: '#16a34a' },
  ])
  const insertedRequest = await tx.raw<{ id: string }>(
    sql`insert into app.department_requests
          (id, requester_user_id, name, description, units, locale, status)
        values (
          ${requestId},
          ${requesterUserId},
          'Litsenziyalash boshqarmasi',
          ${"Litsenziyalar va ruxsatnomalar bilan ishlash bo'yicha boshqarma."},
          ${units}::jsonb,
          'uz-Latn',
          'pending'
        )
        on conflict (id) do nothing
        returning id`,
  )
  rows += insertedRequest.length

  return rows
}

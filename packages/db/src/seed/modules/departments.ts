// EPIC-002 demo seed: three departments total (the foundation's one from `core.ts` plus two more),
// one pending `department_requests` row for the super admin's queue, and two pending join requests
// waiting for the demo department's own boshqarma boshligʻi. `order: 20` -- after `accounts.ts` (10),
// whose `EXTRA_USERS` this module assigns to memberships.
//
// RLS on `app.departments`/`app.memberships` requires `department_id = current_setting('app.department_id')`
// on every write (`migrations/0005_rls.sql`) -- the single `tx` this module receives is bound to the
// *existing* demo department's id for the whole seed run (`demo.ts`'s `demoContext()`), so a second and
// third department's rows need that GUC pointed at their own id instead while they're written (and,
// in `reset()`, deleted). That is `scope.ts`'s `asDepartment`: the one shared connection and
// transaction -- so it always sees `accounts.ts`'s still-uncommitted users -- with only the
// `app.department_id` GUC re-pointed for the duration of one department's statements, restored after.
//
// A second, independently-opened `withContext()` here would be a different pooled connection, hence a
// different Postgres session, and could never see those users (MVCC visibility does not cross
// sessions, committed or not) -- exactly the `memberships_user_id_fkey` violation this module used to
// throw. A real approved `POST /departments/requests/:id/approve` request can afford a fresh
// `withContext()` (`apps/api/src/modules/departments/repo.ts`'s `approveDepartmentRequest`) because by
// then the department's future head/members were committed by their own, earlier, already-finished
// requests; a seed run has no such luxury.
import { randomBytes } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { hash } from '@node-rs/argon2'
import type { Tx } from '../../context.js'
import * as schema from '../../schema/index.js'
import { departmentRequests } from '../../schema/departments.js'
import { DEMO_DEPARTMENT } from '../fixtures.js'
import { demoId } from '../ids.js'
import { asDepartment } from '../scope.js'
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

/**
 * Two people waiting at the demo department's door: `app.memberships` rows with
 * `status = 'pending_approval'`, which is exactly what `GET /departments/:id/join-requests` lists for
 * the boshqarma boshligʻi (`repo.ts`'s `listJoinRequests`). They are what makes the head's very first
 * screen have something on it to *decide*, rather than only something to read.
 *
 * This used to be ten *active* memberships instead -- ten people with generated names and logins like
 * `dilnoza.rashidov27` sitting in the flagship department's board next to the sixteen the story is
 * about. Volume bought nothing and cost the whole cast its credibility; the rest of this pool now
 * fills out the two other departments, where the demo only ever reads a headcount.
 */
const JOIN_REQUEST_USER_INDEXES = [26, 27]
const PENDING_REQUEST_USER_INDEX = 36
const PENDING_REQUEST_ID = demoId('department_request.licensing')

// The one place the ids this module writes are named, so `seed()` and `reset()` cannot drift apart.
function membershipIdsFor(spec: NewDeptSpec): { headId: string; memberIds: string[] } {
  return {
    headId: demoId(`membership.${spec.key}.head`),
    memberIds: spec.memberIndexes.map((idx) => demoId(`membership.${spec.key}.member.${idx}`)),
  }
}

const joinRequestMembershipIds = (): string[] =>
  JOIN_REQUEST_USER_INDEXES.map((idx) => demoId(`membership.core.member.${idx}`))

async function createDepartmentWithHead(tx: Tx, spec: NewDeptSpec): Promise<number> {
  const departmentId = demoId(spec.key)
  const headUserId = extraUserId(EXTRA_USERS[spec.headIndex]!)
  const joinKey = generateJoinKey()
  const joinPasswordHash = await hash(generateJoinPassword())
  const { headId, memberIds } = membershipIdsFor(spec)

  return asDepartment(tx, departmentId, async () => {
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
      { id: headId, userId: headUserId, role: 'head' as const },
      ...spec.memberIndexes.map((idx, i) => ({
        id: memberIds[i]!,
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
  })
}

/** The mirror of `createDepartmentWithHead`: memberships, then the department itself, under that
 * department's own GUC (`departments_write`'s `using` clause needs `id = current_department_id()`;
 * `memberships_write` the same on `department_id` -- neither has a super-admin carve-out). */
async function resetDepartment(tx: Tx, spec: NewDeptSpec): Promise<number> {
  const departmentId = demoId(spec.key)
  const { headId, memberIds } = membershipIdsFor(spec)

  return asDepartment(tx, departmentId, async () => {
    const deletedMemberships = await tx.drizzle
      .delete(schema.memberships)
      .where(inArray(schema.memberships.id, [headId, ...memberIds]))
      .returning({ id: schema.memberships.id })

    const deletedDepartments = await tx.drizzle
      .delete(schema.departments)
      .where(eq(schema.departments.id, departmentId))
      .returning({ id: schema.departments.id })

    return deletedMemberships.length + deletedDepartments.length
  })
}

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  // Sequential, not Promise.all: both departments' statements go down the one shared connection, and
  // the order in which they are written is part of what makes a seed run deterministic.
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

  // Two join requests waiting for the demo department's head. `joined_at` is what the queue sorts and
  // labels by ("2 kun oldin soʻradi"), so the two carry different, believable dates.
  const requestIds = joinRequestMembershipIds()
  const joinRequests = JOIN_REQUEST_USER_INDEXES.map((idx, i) => ({
    id: requestIds[i]!,
    departmentId: DEMO_DEPARTMENT.id,
    userId: extraUserId(EXTRA_USERS[idx]!),
    role: 'member' as const,
    status: 'pending_approval' as const,
    joinedAt: new Date(i === 0 ? '2026-09-04T05:20:00Z' : '2026-09-05T11:40:00Z'),
  }))
  const insertedJoinRequests = await tx.drizzle
    .insert(schema.memberships)
    .values(joinRequests)
    .onConflictDoNothing()
    .returning({ id: schema.memberships.id })
  rows += insertedJoinRequests.length

  // One pending department creation request (TECH-SPEC §2.2), from a user who belongs to no
  // department yet -- the "Litsenziyalash boshqarmasi" (licensing) request the super admin's approval
  // queue demo shows.
  const requester = EXTRA_USERS[PENDING_REQUEST_USER_INDEX]!
  const requesterUserId = extraUserId(requester)
  const units = JSON.stringify([
    { name: 'Litsenziya nazorati', colour: '#2563eb' },
    { name: 'Ruxsatnomalar boʻlimi', colour: '#16a34a' },
  ])
  const insertedRequest = await tx.raw<{ id: string }>(
    sql`insert into app.department_requests
          (id, requester_user_id, name, description, units, locale, status)
        values (
          ${PENDING_REQUEST_ID},
          ${requesterUserId},
          'Litsenziyalash boshqarmasi',
          ${'Litsenziyalar va ruxsatnomalar bilan ishlash boʻyicha boshqarma.'},
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

/** Reverse of `seed()`. The core department's own invite fields are not "un-set" here: that
 * department is deleted outright by `runResetDemo` (`DEMO_DELETE_ORDER`) right after every module's
 * `reset()` has run. */
export async function reset(ctx: SeedModuleContext): Promise<number> {
  const { tx } = ctx
  let rows = 0

  // The pending request references its requester (`accounts.ts`, order 10, whose `reset()` runs after
  // this one). `app.department_requests` is a global table (no RLS) -- a plain delete by id.
  const deletedRequest = await tx.drizzle
    .delete(departmentRequests)
    .where(eq(departmentRequests.id, PENDING_REQUEST_ID))
    .returning({ id: departmentRequests.id })
  rows += deletedRequest.length

  // The two pending join requests in the demo department -- the GUC already matches it.
  const deletedJoinRequests = await tx.drizzle
    .delete(schema.memberships)
    .where(inArray(schema.memberships.id, joinRequestMembershipIds()))
    .returning({ id: schema.memberships.id })
  rows += deletedJoinRequests.length

  // The two departments this module created, in reverse creation order.
  for (const spec of [...NEW_DEPARTMENTS].reverse()) {
    rows += await resetDepartment(tx, spec)
  }

  return rows
}

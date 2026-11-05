import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db, server: Server
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function request(session: Session, path: string, method = 'GET', body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function context(departmentId: string, userId: string): RequestContext {
  return {
    requestId: randomUUID(),
    userId,
    departmentId,
    actorRole: 'member',
    departmentRole: 'member',
    viewAs: false,
    actingForUserId: null,
    ip: '',
    userAgent: 'people-date-test',
  }
}
async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Directory dates',
    slug: `dates-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const owner = await seedMember(db, department.id, { role: 'member' })
  const peer = await seedMember(db, department.id, { role: 'member' })
  const [headSession, ownerSession, peerSession] = await Promise.all(
    [head, owner, peer].map((user) => loginAs(server.baseUrl, user.login)),
  )
  return {
    department,
    head,
    owner,
    peer,
    headSession: headSession!,
    ownerSession: ownerSession!,
    peerSession: peerSession!,
  }
}
const dates = (ctx: RequestContext) =>
  withContext(ctx, (tx) =>
    tx.raw<{ owner_user_id: string; date_of_birth: string }>(
      sql`select owner_user_id, date_of_birth::text from app.directory_birth_dates()`,
    ),
  )

describe('People dates use the canonical owner-written account field within the current department', () => {
  it('projects an exact date to head and peers, null when absent, and follows save/clear without a second copy', async () => {
    const f = await fixture()
    const endpoint = `/departments/${f.department.id}/roster`
    expect(
      (await request(f.ownerSession, '/accounts/profile', 'PATCH', { dateOfBirth: '2000-02-29' }))
        .status,
    ).toBe(200)
    for (const session of [f.headSession, f.peerSession]) {
      const response = await request(session, endpoint)
      expect(response.status).toBe(200)
      const people = (await response.json()) as { userId: string; dateOfBirth: string | null }[]
      expect(people.find((person) => person.userId === f.owner.id)?.dateOfBirth).toBe('2000-02-29')
      expect(people.find((person) => person.userId === f.peer.id)?.dateOfBirth).toBeNull()
    }
    expect(
      (await request(f.ownerSession, '/accounts/profile', 'PATCH', { dateOfBirth: '1999-12-31' }))
        .status,
    ).toBe(200)
    expect(await dates(context(f.department.id, f.peer.id))).toEqual([
      { owner_user_id: f.owner.id, date_of_birth: '1999-12-31' },
    ])
    expect(
      (await request(f.ownerSession, '/accounts/profile', 'PATCH', { dateOfBirth: null })).status,
    ).toBe(200)
    expect(await dates(context(f.department.id, f.peer.id))).toEqual([])
    const people = (await (await request(f.peerSession, endpoint)).json()) as {
      userId: string
      dateOfBirth: string | null
    }[]
    expect(people.find((person) => person.userId === f.owner.id)?.dateOfBirth).toBeNull()
  })

  it('refuses foreign department, removed/view-as/missing actors and excludes removed date owners', async () => {
    const f = await fixture()
    expect(
      (await request(f.ownerSession, '/accounts/profile', 'PATCH', { dateOfBirth: '2001-04-03' }))
        .status,
    ).toBe(200)
    const foreign = await seedDepartment(db, {
      name: 'Other dates',
      slug: `other-dates-${randomUUID()}`,
    })
    const outsider = await seedMember(db, foreign.id, { role: 'member' })
    const foreignSession = await loginAs(server.baseUrl, outsider.login)
    expect((await request(foreignSession, `/departments/${f.department.id}/roster`)).status).toBe(
      403,
    )
    for (const ctx of [
      context(f.department.id, outsider.id),
      context(foreign.id, f.peer.id),
      { ...context(f.department.id, f.peer.id), viewAs: true },
      { ...context(f.department.id, f.peer.id), userId: null },
    ])
      expect(await dates(ctx)).toEqual([])
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
      [f.department.id, f.peer.id],
    )
    expect(await dates(context(f.department.id, f.peer.id))).toEqual([])
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
      [f.department.id, f.owner.id],
    )
    expect(await dates(context(f.department.id, f.head.id))).toEqual([])
  })

  it('keeps direct private-table access and edits owner-only, exposing only the bounded read function', async () => {
    const f = await fixture()
    expect(
      (await request(f.ownerSession, '/accounts/profile', 'PATCH', { dateOfBirth: '1998-06-15' }))
        .status,
    ).toBe(200)
    const head = { ...context(f.department.id, f.head.id), departmentRole: 'head' as const }
    expect(await dates(head)).toEqual([{ owner_user_id: f.owner.id, date_of_birth: '1998-06-15' }])
    const privateRows = await withContext(head, async (tx) => ({
      read: await tx.raw(
        sql`select birth_date from app.account_birthdays where owner_user_id=${f.owner.id}`,
      ),
      updated: await tx.raw(
        sql`update app.account_birthdays set birth_date='1990-01-01' where owner_user_id=${f.owner.id} returning owner_user_id`,
      ),
    }))
    expect(privateRows).toEqual({ read: [], updated: [] })
    expect(await dates(head)).toEqual([{ owner_user_id: f.owner.id, date_of_birth: '1998-06-15' }])
    const grants = await superuserQuery(
      db,
      `select p.prosecdef, p.proconfig,
      exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,
      has_function_privilege('devon_app','app.directory_birth_dates()','EXECUTE') as app_execute
      from pg_proc p where p.oid='app.directory_birth_dates()'::regprocedure`,
    )
    expect(grants).toEqual([
      {
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        public_execute: false,
        app_execute: true,
      },
    ])
  })
})

import { randomUUID } from 'node:crypto'
import { withContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getGlobalAnalytics } from '../../src/modules/admin/repo.js'
import {
  loginAs,
  seedBareUser,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let admin: Session
let adminId: string
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const owner = await seedBareUser(db, { instanceRole: 'super_admin' })
  adminId = owner.id
  admin = await loginAs(server.baseUrl, owner.login)
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})
function request(path: string, session = admin, body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/admin/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function post(path: string, body: unknown = {}) {
  return request(path, admin, body)
}
async function chain() {
  const response = await request('audit/verify')
  expect(response.status).toBe(200)
  const result = (await response.json()) as { ok: boolean; rows: number }
  expect(result.ok).toBe(true)
  return result.rows
}
async function historicalRows() {
  return superuserQuery(db, 'select seq,row_to_json(e) as content from audit.events e order by seq')
}
async function expectHistoryUnchanged(before: Awaited<ReturnType<typeof historicalRows>>) {
  const after = await historicalRows()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after.length).toBeGreaterThan(before.length)
  await chain()
}
function auditContext() {
  return {
    requestId: randomUUID(),
    userId: adminId,
    actorRole: 'super_admin' as const,
    departmentId: null,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'Local integration fixture',
  }
}

describe('admin historical identities and live analytics', () => {
  it('keeps names and former head attribution after deletion while revoking authentication and preserving every audit byte', async () => {
    const department = await seedDepartment(db, {
      name: 'Identity fixture',
      slug: `identity-${randomUUID()}`,
    })
    const head = await seedMember(db, department.id, { role: 'head' })
    await superuserQuery(
      db,
      "update app.users set given_name='Diyor',family_name='Qodirov',patronymic='Testovich',title='Department head' where id=$1",
      [head.id],
    )
    const session = await loginAs(server.baseUrl, head.login)
    const createdCard = await fetch(`${server.baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ title: 'Head audit attribution fixture', assigneeUserId: head.id }),
    })
    expect(createdCard.status).toBe(201)
    const card = (await createdCard.json()) as { id: string }
    const workAudit = await superuserQuery(
      db,
      "select actor_role,department_id from audit.events where subject_id=$1 and action='work.card_created'",
      [card.id],
    )
    expect(workAudit).toEqual([{ actor_role: 'head', department_id: department.id }])
    // The authority used by permission checks is still the instance member role.
    expect(
      (await superuserQuery(db, 'select role from app.users where id=$1', [head.id]))[0],
    ).toEqual({ role: 'member' })
    const before = await historicalRows()
    await chain()
    expect((await post(`accounts/${head.id}/anonymize`)).status).toBe(204)
    const detail = await request(`accounts/${head.id}`)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({
      givenName: 'Diyor',
      familyName: 'Qodirov',
      patronymic: 'Testovich',
      role: 'head',
      status: 'deleted',
      login: `${head.login}.deleted-${head.id}`,
      identityNeedsCorrection: false,
    })
    const persisted = await superuserQuery(
      db,
      'select role,title,password_hash from app.users where id=$1',
      [head.id],
    )
    expect(persisted[0]).toMatchObject({ role: 'member', title: 'Department head' })
    expect(String(persisted[0]!['password_hash'])).toMatch(/^!anonymised:/)
    const oldSessionHeaders = { ...session.headers }
    delete oldSessionHeaders['content-type']
    expect(
      (await fetch(`${server.baseUrl}/api/v1/me`, { headers: oldSessionHeaders })).status,
    ).toBe(401)
    const relogin = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: head.login, password: 'Str0ngExampleValue123' }),
    })
    expect(relogin.status).toBe(401)
    const events = await request(`audit/events?actorUserId=${head.id}`)
    expect(((await events.json()) as { events: unknown[] }).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorName: 'Diyor Qodirov', actorStatus: 'deleted' }),
      ]),
    )
    const historicalHead = await request(
      `accounts?role=head&status=deleted&query=${encodeURIComponent(head.login)}`,
    )
    expect(
      ((await historicalHead.json()) as { users: { id: string }[] }).users.map((row) => row.id),
    ).toEqual([head.id])
    await expectHistoryUnchanged(before)
  })

  it('repairs only legacy erased identities from audited original logins without reviving accounts or editing old events', async () => {
    const user = await seedBareUser(db)
    const session = await loginAs(server.baseUrl, user.login)
    await withContext(auditContext(), async (tx) => {
      tx.audit({
        action: 'admin.user.anonymised',
        subjectType: 'user',
        subjectId: user.id,
        before: { login: user.login, status: 'active' },
        after: { status: 'deleted' },
      })
    })
    await superuserQuery(
      db,
      `update app.users set status='deleted',deleted_at=now(),given_name=$2,family_name='foydalanuvchi',login='deleted-a1b2c3d4',password_hash='!anonymised:fixture' where id=$1`,
      [user.id, "O'chirilgan"],
    )
    const before = await historicalRows()
    expect(await (await request(`accounts/${user.id}`)).json()).toMatchObject({
      identityNeedsCorrection: true,
    })
    const body = {
      givenName: 'Malika',
      familyName: 'Nazarova',
      reason: 'Correct identity using trusted fixture registration records',
    }
    const noCsrfHeaders = { ...admin.headers }
    delete noCsrfHeaders['x-csrf-token']
    const noCsrf = await fetch(
      `${server.baseUrl}/api/v1/admin/accounts/${user.id}/restore-deleted-identity`,
      { method: 'POST', headers: noCsrfHeaders, body: JSON.stringify(body) },
    )
    expect(noCsrf.status).toBe(403)
    expect(
      (
        await post(`accounts/${user.id}/restore-deleted-identity`, {
          ...body,
          originalLogin: 'forged.other.account',
        })
      ).status,
    ).toBe(422)
    expect((await post(`accounts/${user.id}/restore-deleted-identity`, body)).status).toBe(204)
    expect(await (await request(`accounts/${user.id}`)).json()).toMatchObject({
      givenName: 'Malika',
      familyName: 'Nazarova',
      login: `${user.login}.deleted-${user.id}`,
      status: 'deleted',
      identityNeedsCorrection: false,
    })
    const persisted = await superuserQuery(
      db,
      'select password_hash,status,deleted_at from app.users where id=$1',
      [user.id],
    )
    expect(persisted[0]!['password_hash']).toBe('!anonymised:fixture')
    expect(persisted[0]!['deleted_at']).not.toBeNull()
    const sessionHeaders = { ...session.headers }
    delete sessionHeaders['content-type']
    expect((await fetch(`${server.baseUrl}/api/v1/me`, { headers: sessionHeaders })).status).toBe(
      401,
    )
    expect((await post(`accounts/${user.id}/restore-deleted-identity`, body)).status).toBe(404)
    const active = await seedBareUser(db)
    expect((await post(`accounts/${active.id}/restore-deleted-identity`, body)).status).toBe(404)
    const unproven = await seedBareUser(db)
    await superuserQuery(
      db,
      `update app.users set status='deleted',deleted_at=now(),given_name=$2,family_name='foydalanuvchi',login='deleted-deadbeef' where id=$1`,
      [unproven.id, "O'chirilgan"],
    )
    expect((await post(`accounts/${unproven.id}/restore-deleted-identity`, body)).status).toBe(404)
    expect(
      (
        await request(
          `accounts/${user.id}/restore-deleted-identity`,
          await loginAs(server.baseUrl, active.login),
          body,
        )
      ).status,
    ).toBe(403)
    const corrections = await superuserQuery(
      db,
      "select before,after from audit.events where subject_id=$1 and action='admin.user.deleted_identity_restored'",
      [user.id],
    )
    expect(corrections).toHaveLength(1)
    expect(corrections[0]!['after']).toMatchObject({
      givenName: 'Malika',
      familyName: 'Nazarova',
      status: 'deleted',
      reason: body.reason,
    })
    await expectHistoryUnchanged(before)
    await expect(
      withContext(auditContext(), async (tx) => {
        await tx.raw(sql`update audit.events set action='forged' where seq=1`)
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
    await chain()
  })

  it('counts distinct live members and heads, zero-fills eight weeks and meters real AI traces including archived billing', async () => {
    const baseline = await getGlobalAnalytics()
    const live = await seedDepartment(db, {
      name: 'Active analytics fixture',
      slug: `active-${randomUUID()}`,
    })
    const second = await seedDepartment(db, {
      name: 'Second live fixture',
      slug: `second-${randomUUID()}`,
    })
    const archived = await seedDepartment(db, {
      name: 'Archived analytics fixture',
      slug: `archived-${randomUUID()}`,
    })
    const paused = await seedDepartment(db, {
      name: 'Paused analytics fixture',
      slug: `paused-${randomUUID()}`,
    })
    await superuserQuery(db, "update app.departments set status='archived' where id=$1", [
      archived.id,
    ])
    await superuserQuery(db, "update app.departments set status='paused_by_admin' where id=$1", [
      paused.id,
    ])
    const head = await seedMember(db, live.id, { role: 'head' })
    const member = await seedMember(db, live.id, { role: 'member' })
    await superuserQuery(
      db,
      "insert into app.memberships(id,department_id,user_id,role) values($1,$2,$3,'member')",
      [randomUUID(), second.id, member.id],
    )
    const historical = await seedMember(db, archived.id, { role: 'head' })
    await seedMember(db, paused.id, { role: 'member' })
    const deleted = await seedMember(db, live.id, { role: 'member' })
    const locked = await seedMember(db, live.id, { role: 'member' })
    await superuserQuery(db, "update app.users set status='deleted',deleted_at=now() where id=$1", [
      deleted.id,
    ])
    await superuserQuery(db, "update app.users set status='locked' where id=$1", [locked.id])
    await seedBareUser(db)
    await loginAs(server.baseUrl, head.login)
    await loginAs(server.baseUrl, member.login)
    await loginAs(server.baseUrl, historical.login)
    await Promise.all(
      [live, archived].flatMap((dept) => [
        superuserQuery(
          db,
          "insert into app.cards(id,department_id,title,created_by_user_id,done_at) values($1,$2,'Analytics fixture',$3,now())",
          [randomUUID(), dept.id, head.id],
        ),
        superuserQuery(
          db,
          "insert into app.events(id,department_id,title,starts_at,ends_at,organizer_user_id) values($1,$2,'Analytics fixture',now(),now()+interval '1 hour',$3)",
          [randomUUID(), dept.id, head.id],
        ),
        superuserQuery(
          db,
          "insert into app.ai_traces(id,department_id,user_id,feature,model,status,total_tokens,cost_uzs) values($1,$2,$3,'quick_add_parse','local-fixture','ok',123,45)",
          [randomUUID(), dept.id, head.id],
        ),
      ]),
    )
    const actual = await getGlobalAnalytics()
    expect(actual.people.total - baseline.people.total).toBe(2)
    expect(actual.people.active - baseline.people.active).toBe(2)
    expect(actual.people.heads - baseline.people.heads).toBe(1)
    expect(actual.people.members - baseline.people.members).toBe(1)
    expect(actual.people.total).toBe(
      actual.people.superAdmins + actual.people.heads + actual.people.members,
    )
    expect(actual.people.deleted - baseline.people.deleted).toBe(1)
    expect(actual.people.locked - baseline.people.locked).toBe(1)
    expect(actual.departments.total - baseline.departments.total).toBe(3)
    expect(actual.departments.archived - baseline.departments.archived).toBe(1)
    expect(actual.activity.cardsCreated30d - baseline.activity.cardsCreated30d).toBe(1)
    expect(actual.activity.cardsCompleted30d - baseline.activity.cardsCompleted30d).toBe(1)
    expect(actual.activity.eventsCreated30d - baseline.activity.eventsCreated30d).toBe(1)
    expect(actual.activity.logins7d - baseline.activity.logins7d).toBe(2)
    expect(actual.activity.weeklyLogins).toHaveLength(8)
    expect(actual.activity.weeklyLogins.slice(0, 7).every((row) => row.count === 0)).toBe(true)
    expect(
      actual.activity.weeklyLogins.at(-1)!.count - baseline.activity.weeklyLogins.at(-1)!.count,
    ).toBe(2)
    expect(actual.aiSpend.available).toBe(true)
    expect(actual.aiSpend.tokensThisMonth - baseline.aiSpend.tokensThisMonth).toBe(246)
    expect(actual.aiSpend.costUzsThisMonth - baseline.aiSpend.costUzsThisMonth).toBe(90)
    expect(actual.aiSpend.byDepartment).toEqual(
      expect.arrayContaining([expect.objectContaining({ departmentId: archived.id, tokens: 123 })]),
    )
    expect(
      (await request(`accounts?role=head&query=${encodeURIComponent(head.login)}`)).status,
    ).toBe(200)
    expect(await (await request(`accounts/${head.id}`)).json()).toMatchObject({ role: 'head' })
    expect(await (await request(`departments/${live.id}`)).json()).toMatchObject({ memberCount: 2 })
    // The new global event policy is SELECT-only. Member scope and instance-admin writes keep
    // their existing department boundary even though instance analytics can now count all events.
    const allEvents = await withContext(auditContext(), (tx) =>
      tx.raw<{ department_id: string }>(
        sql`select department_id from app.events where department_id in (${live.id},${archived.id})`,
      ),
    )
    expect(allEvents.map((row) => row.department_id).sort()).toEqual([live.id, archived.id].sort())
    const memberEvents = await withContext(
      { ...auditContext(), userId: member.id, actorRole: 'member', departmentId: live.id },
      (tx) =>
        tx.raw<{ department_id: string }>(
          sql`select department_id from app.events where department_id in (${live.id},${archived.id})`,
        ),
    )
    expect(memberEvents.map((row) => row.department_id)).toEqual([live.id])
    const unscopedWrite = await withContext(auditContext(), (tx) =>
      tx.raw(
        sql`update app.events set title='Must not change' where department_id=${live.id} returning id`,
      ),
    )
    expect(unscopedWrite).toEqual([])
  })
})

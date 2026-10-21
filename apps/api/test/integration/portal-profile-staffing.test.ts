import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db, server: Server, head: Session, member: Session, foreign: Session
let departmentId: string, memberId: string
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, { name: 'Portal', slug: `portal-${randomUUID()}` })
  departmentId = department.id
  const other = await seedDepartment(db, { name: 'Foreign', slug: `foreign-${randomUUID()}` })
  const users = await Promise.all([
    seedMember(db, department.id, { role: 'head' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, other.id, { role: 'member' }),
  ])
  memberId = users[1]!.id
  ;[head, member, foreign] = (await Promise.all(
    users.map((u) => loginAs(server.baseUrl, u.login)),
  )) as [Session, Session, Session]
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(path: string, method = 'GET', body?: unknown, session = member) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(server.baseUrl + '/api/v1' + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
describe('professional profiles, staffing and card stages', () => {
  it('lets each user publish their history, rejects stale edits and unsafe links, and scopes the directory', async () => {
    const before = (await (await request('/accounts/professional-profile')).json()) as {
      version: number
    }
    const profile = {
      headline: 'Research analyst',
      phone: '+998 00 000 00 00',
      education: [
        {
          institution: 'Example University',
          degree: 'Bachelor',
          field: 'Economics',
          startYear: 2016,
          endYear: 2020,
          current: false,
        },
        {
          institution: 'Example University',
          degree: 'Master',
          field: 'Policy',
          startYear: 2026,
          endYear: 2028,
          current: true,
        },
      ],
      links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/' }],
    }
    expect(
      (await request('/accounts/professional-profile', 'PUT', { profile, version: before.version }))
        .status,
    ).toBe(200)
    expect(
      (await request('/accounts/professional-profile', 'PUT', { profile, version: before.version }))
        .status,
    ).toBe(409)
    expect(
      (
        await request('/accounts/professional-profile', 'PUT', {
          profile: { links: [{ label: 'Bad', url: 'javascript:alert(1)' }] },
          version: before.version + 1,
        })
      ).status,
    ).toBe(422)
    const roster = (await (
      await request(`/departments/${departmentId}/roster`, 'GET', undefined, head)
    ).json()) as { userId: string; professionalProfile: unknown }[]
    expect(roster.find((m) => m.userId === memberId)?.professionalProfile).toMatchObject(profile)
    expect(
      (await request(`/departments/${departmentId}/roster`, 'GET', undefined, foreign)).status,
    ).toBe(403)
    expect(
      await (await request('/accounts/professional-profile', 'GET', undefined, head)).json(),
    ).toMatchObject({ profile: { headline: '' }, version: 1 })
  })
  it('allows only the head to set staffing and makes the target visible to members', async () => {
    const created = await request(
      `/departments/${departmentId}/units`,
      'POST',
      { name: 'Analysis' },
      head,
    )
    expect(created.status).toBe(201)
    const unit = (await created.json()) as { id: string }
    const path = `/departments/${departmentId}/units/${unit.id}`
    expect((await request(path, 'PATCH', { expectedPeople: 6 })).status).toBe(403)
    expect((await request(path, 'PATCH', { expectedPeople: 6 }, head)).status).toBe(200)
    const overview = (await (await request(`/departments/${departmentId}/units`)).json()) as {
      units: { id: string; expectedPeople: number }[]
    }
    expect(overview.units.find((u) => u.id === unit.id)?.expectedPeople).toBe(6)
    expect((await request(path, 'PATCH', { expectedPeople: -1 }, head)).status).toBe(422)
  })
  it('persists to-do and in-progress independently of completion and protects another owner', async () => {
    const created = await request('/cards', 'POST', { title: 'Stage regression' })
    expect(created.status).toBe(201)
    const card = (await created.json()) as { id: string }
    expect(await (await request(`/cards/${card.id}`)).json()).toMatchObject({
      workStage: 'todo',
      status: 'active',
    })
    expect((await request(`/cards/${card.id}`, 'PATCH', { workStage: 'in_progress' })).status).toBe(
      200,
    )
    expect(await (await request(`/cards/${card.id}`)).json()).toMatchObject({
      workStage: 'in_progress',
      status: 'active',
    })
    expect((await request(`/cards/${card.id}`, 'PATCH', { workStage: 'invalid' })).status).toBe(422)
    expect(
      (await request(`/cards/${card.id}`, 'PATCH', { workStage: 'todo' }, foreign)).status,
    ).toBe(404)
  })
})

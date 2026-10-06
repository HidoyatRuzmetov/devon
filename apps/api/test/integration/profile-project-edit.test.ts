import { randomUUID } from 'node:crypto'
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

let db: Db
let server: Server
let owner: { id: string; login: string }
let colleague: { id: string; login: string }
let stranger: { id: string; login: string }
let auth: Session
let colleagueAuth: Session
let departmentId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const dept = await seedDepartment(db, {
    name: 'Profile projects',
    slug: `profile-${randomUUID()}`,
  })
  departmentId = dept.id
  const other = await seedDepartment(db, { name: 'Other', slug: `other-${randomUUID()}` })
  owner = await seedMember(db, dept.id, { role: 'member' })
  colleague = await seedMember(db, dept.id, { role: 'member' })
  stranger = await seedMember(db, other.id, { role: 'member' })
  auth = await loginAs(server.baseUrl, owner.login)
  colleagueAuth = await loginAs(server.baseUrl, colleague.login)
}, 180_000)
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function request(path: string, method = 'GET', body?: unknown, session = auth) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers: session.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('self-service profile', () => {
  it('updates all editable identity fields, refreshes /me, and signs in with the new login', async () => {
    const login = `renamed.${randomUUID().slice(0, 8)}`
    const profile = {
      login,
      givenName: 'New',
      familyName: 'Name',
      patronymic: 'Family',
      title: 'Engineer',
      email: 'example@example.test',
    }
    const response = await request('/accounts/profile', 'PATCH', profile)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(profile)
    const me = (await (await request('/me')).json()) as { user: Record<string, unknown> }
    expect(me.user['givenName']).toBe('New')
    expect(me.user).not.toHaveProperty('email')
    expect((await loginAs(server.baseUrl, login)).cookie).toBeTruthy()
    const untouched = (await (
      await request('/accounts/profile', 'GET', undefined, colleagueAuth)
    ).json()) as { login: string }
    expect(untouched.login).toBe(colleague.login)
  })
  it('rejects duplicate login, role escalation, blank names and missing CSRF', async () => {
    expect((await request('/accounts/profile', 'PATCH', { login: colleague.login })).status).toBe(
      409,
    )
    expect((await request('/accounts/profile', 'PATCH', { role: 'super_admin' })).status).toBe(422)
    expect((await request('/accounts/profile', 'PATCH', { givenName: '   ' })).status).toBe(422)
    const res = await fetch(`${server.baseUrl}/api/v1/accounts/profile`, {
      method: 'PATCH',
      headers: { cookie: auth.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('project editing and conversion', () => {
  it('rejects a departed person even if a stale membership still says active', async () => {
    const departed = await seedMember(db, departmentId, { role: 'member' })
    await superuserQuery(db, 'update app.memberships set deleted_at = now() where user_id = $1', [
      departed.id,
    ])
    expect(
      (
        await request('/projects', 'POST', {
          title: 'Invalid members',
          ownerUserId: owner.id,
          members: [departed.id],
        })
      ).status,
    ).toBe(422)
  })
  it('keeps owner in membership, allows later editing, rejects outsiders and stale versions', async () => {
    const created = await request('/projects', 'POST', {
      title: 'One person',
      ownerUserId: owner.id,
      members: [owner.id],
    })
    expect(created.status).toBe(201)
    const project = (await created.json()) as { id: string; version: number }
    expect(
      (await request(`/projects/${project.id}`, 'PATCH', { title: 'Unauthorised' }, colleagueAuth))
        .status,
    ).toBe(403)
    expect(
      (await request(`/projects/${project.id}`, 'PATCH', { members: [stranger.id] })).status,
    ).toBe(422)
    const edited = await request(`/projects/${project.id}`, 'PATCH', {
      title: 'Team project',
      members: [colleague.id],
      version: project.version,
    })
    expect(edited.status).toBe(200)
    expect(((await edited.json()) as { members: string[] }).members.sort()).toEqual(
      [owner.id, colleague.id].sort(),
    )
    expect(
      (
        await request(`/projects/${project.id}`, 'PATCH', {
          title: 'Stale',
          version: project.version,
        })
      ).status,
    ).toBe(409)
    expect(
      (await request(`/projects/${project.id}`, 'PATCH', { ownerUserId: colleague.id })).status,
    ).toBe(403)
  })
  it('promotes a card atomically, preserves its children, and prevents duplicate promotion', async () => {
    const response = await request('/cards', 'POST', { title: 'Promote me' })
    expect(response.status).toBe(201)
    const card = (await response.json()) as { id: string }
    const child = await request(`/cards/${card.id}/checklist`, 'POST', {
      text: 'Preserved checklist',
    })
    expect(child.status).toBe(201)
    expect(
      (
        await request(
          '/projects/from-card',
          'POST',
          { cardId: card.id, members: [colleague.id] },
          colleagueAuth,
        )
      ).status,
    ).toBe(403)
    expect(
      (await request('/projects/from-card', 'POST', { cardId: card.id, members: [stranger.id] }))
        .status,
    ).toBe(422)
    const converted = await request('/projects/from-card', 'POST', {
      cardId: card.id,
      members: [colleague.id],
    })
    expect(converted.status).toBe(201)
    const project = (await converted.json()) as { id: string; members: string[] }
    expect(project.members).toContain(owner.id)
    const detail = (await (await request(`/cards/${card.id}`)).json()) as {
      projectId: string
      checklist: { text: string }[]
    }
    expect(detail.projectId).toBe(project.id)
    expect(JSON.stringify(detail)).toContain('Preserved checklist')
    expect(
      (await request('/projects/from-card', 'POST', { cardId: card.id, members: [colleague.id] }))
        .status,
    ).toBe(409)
    const rows = await superuserQuery(
      db,
      'select id from app.projects where department_id = $1 and title = $2',
      [departmentId, 'Promote me'],
    )
    expect(rows).toHaveLength(1)
    const list = (await (await request(`/cards?projectId=${project.id}`)).json()) as {
      items: { id: string }[]
    }
    expect(list.items.map((item) => item.id)).toEqual([card.id])
  })
})

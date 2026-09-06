// `req.actor.memberships`/`departmentId` used to be hardcoded to `[]`/`null` for every request
// (`lib/actor.ts`, EPIC-000: "nobody can be a member of a department that cannot yet be created").
// EPIC-004/005's department-scoped routes need that to be real -- this proves `GET /me` now reports
// the signed-in user's actual `app.memberships` rows (name, role) and picks a stable
// `activeDepartmentId`, rather than every `{kind:'department_child'}` permission check denying
// unconditionally regardless of what is in the database.
import { describe, expect, it } from 'vitest'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'

const PASSWORD = 'Str0ngExampleValue123'

describe('GET /api/v1/me reports real memberships (EPIC-004/005 dependency)', () => {
  it('returns [] and activeDepartmentId null for a user with no membership', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'lone', password: PASSWORD })
    const { app } = await buildTestApp(state)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: PASSWORD },
    })
    const cookies = parseSetCookies(login.headers['set-cookie'])

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().memberships).toEqual([])
    expect(res.json().activeDepartmentId).toBeNull()
    await app.close()
  })

  it('surfaces an active membership (name + role) and makes it the active department', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    state.memberships.push({
      departmentId: '11111111-1111-4111-8111-111111111111',
      departmentName: 'Raqamli xizmatlar boshqarmasi',
      role: 'member',
      userId: user.id,
      status: 'active',
    })
    const { app } = await buildTestApp(state)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: PASSWORD },
    })
    const cookies = parseSetCookies(login.headers['set-cookie'])

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies) },
    })
    const body = res.json()
    expect(body.memberships).toEqual([
      {
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'Raqamli xizmatlar boshqarmasi',
        role: 'member',
      },
    ])
    expect(body.membershipCount).toBe(1)
    expect(body.activeDepartmentId).toBe('11111111-1111-4111-8111-111111111111')
    await app.close()
  })

  it('never surfaces a removed membership', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'left', password: PASSWORD })
    state.memberships.push({
      departmentId: '11111111-1111-4111-8111-111111111111',
      departmentName: 'Old department',
      role: 'member',
      userId: user.id,
      status: 'removed',
    })
    const { app } = await buildTestApp(state)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: PASSWORD },
    })
    const cookies = parseSetCookies(login.headers['set-cookie'])

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies) },
    })
    expect(res.json().memberships).toEqual([])
    await app.close()
  })
})

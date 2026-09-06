// AC-11: a non-super-admin gets 403 with no domain data, and matched vs. unmatched admin paths are
// byte-identical for that same non-super-admin.
import { describe, expect, it } from 'vitest'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'

const PASSWORD = 'Str0ngExampleValue123'

async function loginAs(app: Awaited<ReturnType<typeof buildTestApp>>['app'], login: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login, password: PASSWORD },
  })
  return cookieHeader(parseSetCookies(res.headers['set-cookie']))
}

describe('GET /api/v1/admin/instance -- a member session (break attempt 1)', () => {
  it('gets 403 with an RFC 9457 body carrying no domain data', async () => {
    const state = createFakeState()
    const member = await seedUser(state, { login: 'member1', password: PASSWORD, role: 'member' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, member.login)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/instance',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.code).toBe('forbidden')
    expect(JSON.stringify(body)).not.toContain(member.id)
    expect(JSON.stringify(body)).not.toMatch(/select |\/src\//i)
    await app.close()
  })

  it('writes an access.denied audit row naming the route', async () => {
    const state = createFakeState()
    const member = await seedUser(state, { login: 'member1', password: PASSWORD, role: 'member' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, member.login)

    await app.inject({ method: 'GET', url: '/api/v1/admin/instance', headers: { cookie } })
    const denied = state.auditEvents.find((e) => e.action === 'access.denied')
    expect(denied).toBeDefined()
    expect(denied?.actorUserId).toBe(member.id)
    expect(denied?.subjectId).toContain('/api/v1/admin/instance')
    await app.close()
  })
})

describe('a forged role claim (break attempt 2)', () => {
  it('a client-supplied role header never elevates a member session', async () => {
    const state = createFakeState()
    const member = await seedUser(state, { login: 'member1', password: PASSWORD, role: 'member' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, member.login)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/instance',
      headers: { cookie, 'x-role': 'super_admin', 'x-user-role': 'super_admin' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('deep link to a non-existent admin path (break attempt 3)', () => {
  it('an unauthenticated request to /admin/* gets 401, never a 404 that reveals existence', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/does-not-exist' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('a member session gets a 403 body byte-identical to the matched-route 403', async () => {
    const state = createFakeState()
    const member = await seedUser(state, { login: 'member1', password: PASSWORD, role: 'member' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, member.login)

    const matched = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/instance',
      headers: { cookie },
    })
    const unmatched = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/does-not-exist',
      headers: { cookie },
    })
    expect(unmatched.statusCode).toBe(403)
    expect(unmatched.body).toBe(matched.body)
    await app.close()
  })

  it('a member session cannot tell an existing admin sub-route from a missing one by wording', async () => {
    const state = createFakeState()
    const member = await seedUser(state, { login: 'member1', password: PASSWORD, role: 'member' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, member.login)

    const a = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit/verify',
      headers: { cookie },
    })
    const b = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/nonexistent-xyz',
      headers: { cookie },
    })
    expect(a.statusCode).toBe(b.statusCode)
    expect(a.body).toBe(b.body)
    await app.close()
  })
})

describe('a super_admin session', () => {
  it('reads /admin/instance and /admin/audit/verify successfully', async () => {
    const state = createFakeState()
    const admin = await seedUser(state, { login: 'root', password: PASSWORD, role: 'super_admin' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, admin.login)

    const instanceRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/instance',
      headers: { cookie },
    })
    expect(instanceRes.statusCode).toBe(200)

    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit/verify',
      headers: { cookie },
    })
    expect(auditRes.statusCode).toBe(200)
    expect(auditRes.json().ok).toBe(true)
    await app.close()
  })

  it('gets a real 404 for a genuinely missing admin route', async () => {
    const state = createFakeState()
    const admin = await seedUser(state, { login: 'root', password: PASSWORD, role: 'super_admin' })
    const { app } = await buildTestApp(state)
    const cookie = await loginAs(app, admin.login)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/does-not-exist',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

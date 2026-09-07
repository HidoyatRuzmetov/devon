// Route-wiring smoke tests: no Postgres (the `unit` gate never touches it), so these prove the
// permission/boot-time wiring around `apps/api/src/modules/ai/index.ts` -- exactly the same shape as
// `apps/api/test/unit/events/routes.test.ts` -- rather than any service-layer business logic.
//
// `req.actor.memberships` is always `[]` for a freshly seeded fake user (`apps/api/src/lib/actor.ts`'s
// own header comment), so every `department_child`/`department` route below denies with `forbidden`
// for a signed-in member with no session-level department -- the documented, fail-closed contract.
import { describe, expect, it } from 'vitest'
import { createFakeState } from '../fake-deps.js'
import { seedUser } from '../seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from '../test-app.js'

const PASSWORD = 'Str0ngExampleValue123'

async function signIn(app: Awaited<ReturnType<typeof buildTestApp>>['app'], login: string) {
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login, password: PASSWORD },
  })
  const cookies = parseSetCookies(loginRes.headers['set-cookie'])
  return { cookie: cookieHeader(cookies), csrf: cookies['devon_csrf'] ?? '' }
}

describe('GET /api/v1/ai/settings', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/settings' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('denies a signed-in member with no department membership (fail-closed, not a 500)', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie } = await signIn(app, user.login)

    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/settings', headers: { cookie } })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })
})

describe('PATCH /api/v1/ai/settings', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/settings',
      payload: { budgetUzsPerMonth: 1_000_000 },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('denies a signed-in member with no department membership (a head-only action too)', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie, csrf } = await signIn(app, user.login)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/settings',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { budgetUzsPerMonth: 1_000_000 },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('GET /api/v1/ai/usage', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/usage' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('denies a signed-in member with no department membership', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie } = await signIn(app, user.login)

    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/usage', headers: { cookie } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('POST /api/v1/ai/features/:feature/run', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/features/translate/run',
      payload: { input: { locale: 'en', text: 'hello' } },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('denies a department feature (translate) for a member with no department membership', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie, csrf } = await signIn(app, user.login)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/features/translate/run',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { input: { locale: 'en', text: 'hello' } },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })

  it('rejects an unknown feature id (schema validation, not a 500)', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie, csrf } = await signIn(app, user.login)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/features/not_a_real_feature/run',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { input: {} },
    })
    expect(res.statusCode).toBe(422)
    await app.close()
  })
})

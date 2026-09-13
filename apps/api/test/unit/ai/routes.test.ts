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

  // v1.1 integration: a made-up feature id never reaches schema validation any more, because this
  // caller has no department and `plugins/authorize.ts` now refuses at `preValidation` (see that
  // file). What the test is actually for -- "a nonsense id is a 4xx, never a 500" -- is unchanged,
  // and is now asserted for both callers: refused for one who may not run features at all, and
  // 422'd for one who may.
  it('rejects an unknown feature id with a 4xx, never a 500', async () => {
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
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })

  // H7.4 "AI input length" is the route's own `preValidation` hook (index.ts). v1.1 integration made
  // `plugins/authorize.ts` a *global* `preValidation` hook, and Fastify runs a phase's global hooks
  // before a route's own -- so the size guard is now reached only by a caller who is allowed to run
  // the feature at all, which is exactly the caller who could otherwise spend the department's
  // tokens. Refusing a stranger (401) and a member with no department (403) without measuring their
  // payload is the cheaper answer of the two and reveals less.
  //
  // This fake-state harness cannot mint a member *with* a department (`fake-deps.ts`: memberships
  // are always `[]`, see this file's header), so the 422 itself is proven where a real department
  // exists -- `packages/ai`'s own limit tests and the integration profile. What is asserted here is
  // the ordering that changed.
  it('refuses an oversized input at the door, before it is ever measured', async () => {
    const oversized = {
      method: 'POST' as const,
      url: '/api/v1/ai/features/translate/run',
      // Default AI_MAX_INPUT_BYTES is 32 KiB; comfortably over that, well under the app-wide
      // HTTP_BODY_LIMIT_BYTES (1 MiB) so this would exercise the AI-specific limit, not the generic one.
      payload: { input: { text: 'x'.repeat(64 * 1024) } },
    }

    const anonymous = await buildTestApp()
    const anonRes = await anonymous.app.inject(oversized)
    expect(anonRes.statusCode).toBe(401)
    expect(anonRes.json()).not.toHaveProperty('errors')
    await anonymous.app.close()

    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie, csrf } = await signIn(app, user.login)
    const res = await app.inject({ ...oversized, headers: { cookie, 'x-csrf-token': csrf } })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })
})

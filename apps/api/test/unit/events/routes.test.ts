// Route-wiring smoke tests: no Postgres (the `unit` gate never touches it), so these prove the
// permission/CSRF/boot-time wiring around `apps/api/src/modules/events/index.ts` rather than any
// service-layer business logic (covered by `logic.test.ts`/`ics.test.ts` instead).
//
// `req.actor.memberships` is always `[]` today (`apps/api/src/lib/actor.ts`'s own header comment --
// EPIC-002/accounts-departments populates it). That makes every `department_child` route deny with
// `forbidden` for a signed-in member with no session-level department, which is the documented,
// fail-closed contract this module is built against (see `index.ts`'s header comment) -- these tests
// pin that behaviour down so a future change to `actor.ts` is the only thing that can move it.
import { describe, expect, it } from 'vitest'
import { createFakeState } from '../fake-deps.js'
import { seedUser } from '../seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from '../test-app.js'

const PASSWORD = 'Str0ngExampleValue123'

const VALID_EVENT_BODY = {
  title: 'Kuz piknigi',
  startsAt: '2026-09-20T09:00:00+05:00',
  endsAt: '2026-09-20T15:00:00+05:00',
}

async function signIn(app: Awaited<ReturnType<typeof buildTestApp>>['app'], login: string) {
  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login, password: PASSWORD },
  })
  const cookies = parseSetCookies(loginRes.headers['set-cookie'])
  return { cookie: cookieHeader(cookies), csrf: cookies['devon_csrf'] ?? '' }
}

describe('GET /api/v1/events', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/events' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('denies a signed-in member with no department membership (fail-closed, not a 500)', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'nodira', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie } = await signIn(app, user.login)

    const res = await app.inject({ method: 'GET', url: '/api/v1/events', headers: { cookie } })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })
})

describe('POST /api/v1/events', () => {
  it('requires authentication', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: VALID_EVENT_BODY,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('denies a signed-in member with no department membership, never reaching the handler', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'anvar', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const { cookie, csrf } = await signIn(app, user.login)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: VALID_EVENT_BODY,
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  // v1.1 integration: this used to assert 422 -- schema validation ran ahead of the permission
  // check, so a caller with no session learned the shape of the body before being told they may not
  // send one. `plugins/authorize.ts` now runs at `preValidation` (its own comment has the
  // `/admin/wipe/start` case that forced the change), so the refusal comes first and the body is
  // never judged. The assertion is deliberately the stronger one: a stranger gets exactly "who are
  // you", and nothing about this endpoint.
  it('refuses an unauthenticated caller before it parses their body -- no schema hints for a stranger', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'unauthenticated' })
    // The point of the test: no field-by-field validation report, which is what would name this
    // endpoint's body. (`title` in the payload above is an RFC 9457 member of every Problem, so the
    // absence of `errors` is the honest assertion here.)
    expect(res.json()).not.toHaveProperty('errors')
    await app.close()
  })
})

describe('GET /api/v1/openapi.json', () => {
  it('documents the events routes without throwing at boot (refined Zod schemas included)', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    expect(res.statusCode).toBe(200)
    const paths = Object.keys(res.json().paths as Record<string, unknown>)
    expect(paths).toContain('/api/v1/events/')
    expect(paths.some((p) => p.startsWith('/api/v1/events/{eventId}'))).toBe(true)
    await app.close()
  })
})

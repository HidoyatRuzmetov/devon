// H1.4 (CSRF double-submit enforced globally, not per route). The regression this pins: before this
// pass, `modules/structure/index.ts`'s seven mutating routes and `POST /auth/logout` called
// `checkCsrf` nowhere at all, so a cross-site form post from a page the victim visited while signed
// in could create, rename, reorder or delete a department's whole org structure.
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { CSRF_EXEMPT_ROUTES } from '../../src/plugins/csrf-guard.js'

const PASSWORD = 'Str0ngExampleValue123'
const DEPARTMENT_ID = '11111111-1111-4111-8111-111111111111'

/** Signs a member of one department in and returns the cookies plus the raw CSRF token. */
async function signedInMember() {
  const state = createFakeState()
  const user = await seedUser(state, {
    login: `member-${randomUUID().slice(0, 6)}`,
    password: PASSWORD,
  })
  state.memberships.push({
    userId: user.id,
    departmentId: DEPARTMENT_ID,
    departmentName: 'Raqamli rivojlanish',
    role: 'head',
    status: 'active',
  })
  const { app } = await buildTestApp(state)
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: user.login, password: PASSWORD },
  })
  const cookies = parseSetCookies(login.headers['set-cookie'])
  return { app, state, user, cookie: cookieHeader(cookies), csrf: cookies['devon_csrf'] as string }
}

describe('global CSRF guard (H1.4)', () => {
  it('refuses a mutation carried only by the session cookie', async () => {
    const { app, cookie } = await signedInMember()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts/sessions/revoke-all',
      headers: { cookie },
    })
    // 403 from the guard, before the handler runs.
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })

  it('covers every state-changing route the app registers', async () => {
    const { app } = await buildTestApp()
    const unprotected = app.csrfRoutes.filter((r) => r.exempt)
    // The only routes the guard skips are the pre-session public ones (a caller with no session has
    // no CSRF cookie to double-submit yet) and the one declared exemption. Anything else appearing
    // here is a route that lost its CSRF protection.
    expect(unprotected.map((r) => `${r.method} ${r.url}`).sort()).toEqual(
      [
        'POST /api/v1/accounts/2fa/login-verify',
        // v1.1: the login screen's "ask my head to reset my password" -- pre-session by definition,
        // so there is no CSRF cookie to double-submit. It is rate limited, answers 202 whatever it
        // finds, and its only effect is an inbox item for a head.
        'POST /api/v1/accounts/password-reset-request',
        'POST /api/v1/accounts/register',
        'POST /api/v1/auth/login',
        'POST /api/v1/setup/:token',
        'POST /api/v1/telegram/webhook/:secret',
        'PUT /api/v1/storage/uploads',
        // v1.1 EPIC-019 CalDAV-lite. Every one of these is `public: true` for the same reason the
        // ICS feed is: a calendar client (iOS, Thunderbird, Evolution) carries no session cookie,
        // so the 256-bit secret in the path is the only credential, and the session cookie grants
        // these routes exactly nothing. CSRF protects against a cross-site request riding ambient
        // cookie authority -- there is none here to ride, and an attacker who already knows the
        // secret does not need the victim's browser.
        //
        // PROPFIND/REPORT/GET are reads. PUT and DELETE exist only so a write-capable client is
        // told "read-only calendar" (403, unconditionally, before the body is looked at) rather
        // than "server broken" (404) -- they change nothing, ever, for any caller.
        'PROPFIND /api/v1/caldav/:secret/',
        'PROPFIND /api/v1/caldav/:secret/calendar/',
        'REPORT /api/v1/caldav/:secret/calendar/',
        'PUT /api/v1/caldav/:secret/calendar/',
        'PUT /api/v1/caldav/:secret/calendar/:resource',
        'DELETE /api/v1/caldav/:secret/calendar/',
        'DELETE /api/v1/caldav/:secret/calendar/:resource',
      ].sort(),
    )
    // Sanity: the table really is the whole route table, not an empty list.
    expect(app.csrfRoutes.length).toBeGreaterThan(80)
    // Every structure mutation -- the module that had no CSRF check at all before this pass -- is in
    // the protected set.
    const structure = app.csrfRoutes.filter((r) => r.url.includes('/units'))
    expect(structure.length).toBeGreaterThan(0)
    expect(structure.every((r) => !r.exempt)).toBe(true)
    await app.close()
  })

  it('refuses a mutation whose header does not match the cookie', async () => {
    const { app, cookie } = await signedInMember()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, 'x-csrf-token': 'a-token-from-somewhere-else' },
      payload: { locale: 'ru' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('allows a mutation that double-submits the token', async () => {
    const { app, cookie, csrf } = await signedInMember()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { locale: 'ru' },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('leaves safe methods alone', async () => {
    const { app, cookie } = await signedInMember()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('lets a pre-session public POST through (login, register, 2FA verify, setup)', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'nobody', password: 'wrong-example-value' },
    })
    // 401 from the credential check, never a CSRF 403: these routes are reached without a session.
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('still answers 401, not 403, for an unauthenticated mutation of a protected route', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/me', payload: { locale: 'ru' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

describe('CSRF exemption allow-list (H1.4)', () => {
  it('holds exactly one entry, so an addition is always a visible diff', () => {
    expect([...CSRF_EXEMPT_ROUTES]).toEqual([{ method: 'PUT', url: '/api/v1/storage/uploads' }])
  })

  it('the exempt storage upload route is not refused for a missing CSRF header', async () => {
    const state = createFakeState()
    await seedUser(state, { login: 'uploader', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'uploader', password: PASSWORD },
    })
    const cookie = cookieHeader(parseSetCookies(login.headers['set-cookie']))
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/storage/uploads?token=not-a-real-token',
      headers: { cookie, 'content-type': 'image/png' },
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    })
    // 404 (the token does not verify), never 403 (CSRF) -- the guard let it through.
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

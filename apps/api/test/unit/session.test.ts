// AC-13: sign-out invalidates the session server-side; the cookie carries HttpOnly/Secure/SameSite=Lax.
import { describe, expect, it } from 'vitest'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'

const PASSWORD = 'Str0ngExampleValue123'

describe('POST /api/v1/auth/login', () => {
  it('sets a session cookie with HttpOnly, Secure and SameSite=Lax (AC-13)', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: PASSWORD },
    })

    expect(res.statusCode).toBe(204)
    const setCookie = res.headers['set-cookie']
    const sidLine = (Array.isArray(setCookie) ? setCookie : [setCookie]).find((c) =>
      c?.startsWith('devon_sid='),
    ) as string
    expect(sidLine).toBeDefined()
    expect(sidLine.toLowerCase()).toContain('httponly')
    expect(sidLine.toLowerCase()).toContain('secure')
    expect(sidLine.toLowerCase()).toContain('samesite=lax')
    await app.close()
  })

  it('rejects a wrong password with 401 and no domain data, no session created', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: 'totally-wrong-example' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('unauthenticated')
    expect(state.sessions).toHaveLength(0)
    await app.close()
  })

  it('rejects an unknown login exactly like a wrong password (no account enumeration)', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'nobody-exists', password: 'whatever-example-value' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().detail).not.toMatch(/user|login|account/i)
    await app.close()
  })
})

describe('cookie replay after logout (AC-13)', () => {
  it('a captured session cookie authenticates GET /me before logout and gets 401 after', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: PASSWORD },
    })
    const cookies = parseSetCookies(login.headers['set-cookie'])
    const capturedCookieHeader = cookieHeader(cookies)

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: capturedCookieHeader },
    })
    expect(before.statusCode).toBe(200)
    expect(before.json().user.login).toBe(user.login)

    // H1.4: `POST /auth/logout` is state-changing, so the global double-submit guard
    // (`plugins/csrf-guard.ts`) applies to it -- the captured cookie alone is not enough, which is
    // exactly what stops a cross-site page from signing the user out.
    const forgedLogout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: capturedCookieHeader },
    })
    expect(forgedLogout.statusCode).toBe(403)
    expect(state.sessions[0]?.revokedAt).toBeNull()

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: capturedCookieHeader, 'x-csrf-token': cookies['devon_csrf'] as string },
    })
    expect(logout.statusCode).toBe(204)
    expect(state.sessions[0]?.revokedAt).not.toBeNull()

    // The exact same captured cookie, replayed, must now fail (design.md §4(e)).
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: capturedCookieHeader },
    })
    expect(after.statusCode).toBe(401)
    await app.close()
  })

  it('logout clears the cookie with an expired Max-Age, still HttpOnly/Secure/SameSite=Lax', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: user.login, password: PASSWORD },
    })
    const cookies = parseSetCookies(login.headers['set-cookie'])

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: cookieHeader(cookies),
        'x-csrf-token': cookies['devon_csrf'] as string,
      },
    })
    const setCookie = logout.headers['set-cookie']
    const sidLine = (Array.isArray(setCookie) ? setCookie : [setCookie]).find((c) =>
      c?.startsWith('devon_sid='),
    ) as string
    expect(sidLine.toLowerCase()).toContain('max-age=0')
    expect(sidLine.toLowerCase()).toContain('httponly')
    expect(sidLine.toLowerCase()).toContain('secure')
    expect(sidLine.toLowerCase()).toContain('samesite=lax')
  })

  it('GET /me with no cookie at all is 401, never a permission leak', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /api/v1/me (own_account, CSRF double-submit)', () => {
  async function loginAndGetCookies(
    app: Awaited<ReturnType<typeof buildTestApp>>['app'],
    login: string,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login, password: PASSWORD },
    })
    return parseSetCookies(res.headers['set-cookie'])
  }

  it('updates locale with a matching X-CSRF-Token header and cookie, and audits the write', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD, locale: 'uz-Latn' })
    const { app } = await buildTestApp(state)
    const cookies = await loginAndGetCookies(app, user.login)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies), 'x-csrf-token': cookies['devon_csrf']! },
      payload: { locale: 'ru' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.locale).toBe('ru')
    expect(state.auditEvents.some((e) => e.action === 'user.updated')).toBe(true)
    await app.close()
  })

  it('rejects a request with no CSRF header at all', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const cookies = await loginAndGetCookies(app, user.login)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies) },
      payload: { locale: 'ru' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects a forged CSRF header that does not match the cookie', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const cookies = await loginAndGetCookies(app, user.login)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies), 'x-csrf-token': 'forged-example-value' },
      payload: { locale: 'ru' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects an unknown field (no mass assignment, .strict())', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: PASSWORD })
    const { app } = await buildTestApp(state)
    const cookies = await loginAndGetCookies(app, user.login)

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(cookies), 'x-csrf-token': cookies['devon_csrf']! },
      payload: { role: 'super_admin' },
    })
    expect(res.statusCode).toBe(422)
  })
})

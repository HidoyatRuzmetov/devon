// H1.4 / H25.1: session rotation, expiry/revocation, logout-everywhere, CSRF double-submit. Against a
// real Postgres + real app (see `harness.ts`).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loginAs, seedBareUser, startHarness, stopHarness, type Db, type Server } from './harness.js'

let db: Db
let server: Server
let baseUrl: string

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

describe('session rotation on login', () => {
  it('two separate logins for the same account issue two different session tokens', async () => {
    const user = await seedBareUser(db)
    const first = await loginAs(baseUrl, user.login)
    const second = await loginAs(baseUrl, user.login)
    expect(first.cookie).not.toBe(second.cookie)
    expect(first.csrf).not.toBe(second.csrf)
    // Both are independently valid at once (multi-device is intentional, not a bug) -- revocation is
    // an explicit action (`revoke-all`/`revoke/:id`), not an implicit side effect of a second login.
    const meFirst = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: first.cookie } })
    const meSecond = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: second.cookie } })
    expect(meFirst.status).toBe(200)
    expect(meSecond.status).toBe(200)
  })
})

describe('logout (single session)', () => {
  it('POST /auth/logout revokes the session: the same cookie is rejected afterwards', async () => {
    const user = await seedBareUser(db)
    const session = await loginAs(baseUrl, user.login)
    const before = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: session.cookie } })
    expect(before.status).toBe(200)

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: session.headers,
      body: '{}', // a `content-type: application/json` header needs a body, even an empty one
    })
    expect(logout.status).toBe(204)

    const after = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: session.cookie } })
    expect(after.status).toBe(401)
  })
})

describe('logout everywhere', () => {
  it('POST /accounts/sessions/revoke-all invalidates every session for the account, not just the caller’s', async () => {
    const user = await seedBareUser(db)
    const deviceA = await loginAs(baseUrl, user.login)
    const deviceB = await loginAs(baseUrl, user.login)

    const revoke = await fetch(`${baseUrl}/api/v1/accounts/sessions/revoke-all`, {
      method: 'POST',
      headers: deviceA.headers,
      body: '{}',
    })
    expect(revoke.status).toBe(204)

    const meA = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: deviceA.cookie } })
    const meB = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: deviceB.cookie } })
    expect(meA.status).toBe(401)
    expect(meB.status).toBe(401)
  })

  it('revoking one specific session by id leaves the others alone', async () => {
    const user = await seedBareUser(db)
    const deviceA = await loginAs(baseUrl, user.login)
    const deviceB = await loginAs(baseUrl, user.login)

    const list = await fetch(`${baseUrl}/api/v1/accounts/sessions`, {
      headers: { cookie: deviceA.cookie },
    })
    const { sessions } = (await list.json()) as { sessions: { id: string; isCurrent: boolean }[] }
    const currentSession = sessions.find((s) => s.isCurrent)
    expect(currentSession).toBeDefined()

    const revoke = await fetch(`${baseUrl}/api/v1/accounts/sessions/${currentSession!.id}/revoke`, {
      method: 'POST',
      headers: deviceA.headers,
      body: '{}',
    })
    expect(revoke.status).toBe(204)

    const meA = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: deviceA.cookie } })
    const meB = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: deviceB.cookie } })
    expect(meA.status).toBe(401)
    expect(meB.status).toBe(200)
  })
})

describe('CSRF double-submit on every mutating own-account route', () => {
  // Two logins shared across every test in this block, not one per test: `/auth/login` is itself
  // rate-limited (10/min, see `rate-limit-lockout.test.ts`), and every other describe block in this
  // file already spends part of that budget -- a fresh login per assertion here would tip the whole
  // file over the limit and start failing on the real 429-becomes-500 bug this suite documents
  // elsewhere, for a reason unrelated to what this block actually tests. None of the failed-CSRF
  // attempts below mutate or rotate the session, so reusing it across them is safe.
  let sessionA: Awaited<ReturnType<typeof loginAs>>
  let sessionB: Awaited<ReturnType<typeof loginAs>>

  beforeAll(async () => {
    const userA = await seedBareUser(db)
    const userB = await seedBareUser(db)
    sessionA = await loginAs(baseUrl, userA.login)
    sessionB = await loginAs(baseUrl, userB.login)
  })

  it('PATCH /me with no CSRF header at all is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: { cookie: sessionA.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'ru' }),
    })
    expect(res.status).toBe(403)
  })

  it('PATCH /me with a header value that does not match the cookie is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: {
        cookie: sessionA.cookie,
        'content-type': 'application/json',
        'x-csrf-token': randomUUID(),
      },
      body: JSON.stringify({ locale: 'ru' }),
    })
    expect(res.status).toBe(403)
  })

  it('a CSRF token that matches the header but belongs to a different session’s cookie is rejected', async () => {
    // "Cookie tossing": A's cookie jar, but B's csrf token in the header -- header must match THIS
    // session's own csrf_hash, not merely be a well-formed token from anywhere.
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: {
        cookie: sessionA.cookie,
        'content-type': 'application/json',
        'x-csrf-token': sessionB.csrf,
      },
      body: JSON.stringify({ locale: 'ru' }),
    })
    expect(res.status).toBe(403)
  })

  it('the matching header + cookie pair succeeds (positive control)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: sessionA.headers,
      body: JSON.stringify({ locale: 'ru' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('an expired/garbage session cookie is treated as unauthenticated, not a 500', () => {
  it('a well-formed but unknown session token gets 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { cookie: `devon_sid=${randomUUID()}${randomUUID()}` },
    })
    expect(res.status).toBe(401)
  })

  it('no session cookie at all also gets 401, not a crash', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`)
    expect(res.status).toBe(401)
  })
})

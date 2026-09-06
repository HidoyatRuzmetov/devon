// AC-13 evidence producer (design.md §9): "Set-Cookie header + post-logout replay 401" -- against a
// real Postgres so `app.sessions.revoked_at` is the actual revocation record being exercised (ADR-003).
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'

async function main(): Promise<void> {
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  console.log(`api listening at ${server.baseUrl}`)

  try {
    step('bootstrap: create the super admin via setup')
    const issued = await server.deps.ensureSetupToken()
    await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'session.prove',
        password: 'Str0ngExampleValue123',
        givenName: 'Aziz',
        familyName: 'Yusupov',
        locale: 'uz-Latn',
      }),
    })

    step('POST /api/v1/auth/login')
    const loginRes = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'session.prove', password: 'Str0ngExampleValue123' }),
    })
    assertEqual(loginRes.status, 204, 'login status')
    const setCookies = loginRes.headers.getSetCookie()
    for (const c of setCookies) console.log(`  Set-Cookie: ${c}`)
    const sidLine = setCookies.find((c) => c.startsWith('devon_sid='))!
    assertTrue(sidLine.toLowerCase().includes('httponly'), 'devon_sid carries HttpOnly')
    assertTrue(sidLine.toLowerCase().includes('secure'), 'devon_sid carries Secure')
    assertTrue(sidLine.toLowerCase().includes('samesite=lax'), 'devon_sid carries SameSite=Lax')
    const cookies = parseCookies(setCookies)
    const captured = cookieHeader(cookies)

    step('the captured cookie authenticates GET /api/v1/me')
    const meBefore = await fetch(`${server.baseUrl}/api/v1/me`, { headers: { cookie: captured } })
    assertEqual(meBefore.status, 200, 'GET /me before logout')
    console.log(
      `  request: GET /api/v1/me\n  cookie: ${captured}\n  response: 200 ${JSON.stringify(await meBefore.json())}`,
    )

    step('POST /api/v1/auth/logout')
    const logoutRes = await fetch(`${server.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: captured },
    })
    assertEqual(logoutRes.status, 204, 'logout status')

    step('replaying the SAME captured cookie now fails')
    const meAfter = await fetch(`${server.baseUrl}/api/v1/me`, { headers: { cookie: captured } })
    console.log(
      `  request: GET /api/v1/me\n  cookie: ${captured}\n  response: ${meAfter.status} ${JSON.stringify(await meAfter.json())}`,
    )
    assertEqual(meAfter.status, 401, 'GET /me after logout, same cookie')

    console.log('\nsession:prove PASSED')
  } finally {
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error('\nsession:prove FAILED')
  console.error(err)
  process.exit(1)
})

// AC-11 evidence producer (design.md §9): "member session -> 403 body, forged role -> 403, deep link ->
// no-permission, matching audit rows" -- against a real Postgres.
import { Client } from 'pg'
import { hashPassword } from '../../src/lib/password.js'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'

async function insertMember(appUrl: string, login: string, password: string): Promise<void> {
  const client = new Client({ connectionString: appUrl })
  await client.connect()
  try {
    // `app.users` is a global table (no RLS, design.md §2.1) -- a direct insert as the app role is a
    // legitimate write path, exactly what `POST /setup/{token}` itself does under the hood.
    await client.query(
      `insert into app.users (login, password_hash, given_name, family_name, role)
       values ($1, $2, 'Malika', 'Karimova', 'member')`,
      [login, await hashPassword(password)],
    )
  } finally {
    await client.end()
  }
}

async function login(baseUrl: string, loginName: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: loginName, password }),
  })
  if (res.status !== 204) throw new Error(`login as ${loginName} failed: ${res.status}`)
  return cookieHeader(parseCookies(res.headers.getSetCookie()))
}

async function main(): Promise<void> {
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  console.log(`api listening at ${server.baseUrl}`)

  try {
    step('bootstrap: one super admin, one member')
    const issued = await server.deps.ensureSetupToken()
    await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'admin.prove',
        password: 'Str0ngExampleValue123',
        givenName: 'Aziz',
        familyName: 'Yusupov',
        locale: 'uz-Latn',
      }),
    })
    await insertMember(db.appUrl, 'member.prove', 'Str0ngExampleValue123')

    const memberCookie = await login(server.baseUrl, 'member.prove', 'Str0ngExampleValue123')
    const adminCookie = await login(server.baseUrl, 'admin.prove', 'Str0ngExampleValue123')

    step('break attempt 1: direct API call with a member session')
    const direct = await fetch(`${server.baseUrl}/api/v1/admin/instance`, {
      headers: { cookie: memberCookie },
    })
    const directBody = await direct.text()
    console.log(`  GET /api/v1/admin/instance -> ${direct.status} ${directBody}`)
    assertEqual(direct.status, 403, 'member direct call status')
    assertTrue(!directBody.includes('member.prove'), 'no domain data (login) in the 403 body')

    step('break attempt 2: a forged role claim (client-supplied headers)')
    const forged = await fetch(`${server.baseUrl}/api/v1/admin/instance`, {
      headers: { cookie: memberCookie, 'x-role': 'super_admin', 'x-user-role': 'super_admin' },
    })
    console.log(`  GET /api/v1/admin/instance (forged headers) -> ${forged.status}`)
    assertEqual(forged.status, 403, 'forged-role call status')

    step('break attempt 3: deep link to a non-existent /admin/* path')
    const deepLink = await fetch(`${server.baseUrl}/api/v1/admin/does-not-exist`, {
      headers: { cookie: memberCookie },
    })
    const deepLinkBody = await deepLink.text()
    console.log(`  GET /api/v1/admin/does-not-exist -> ${deepLink.status} ${deepLinkBody}`)
    assertEqual(deepLink.status, 403, 'deep-link to unmatched admin path status')
    assertEqual(
      deepLinkBody,
      directBody,
      'byte-identical body: matched vs. unmatched admin path (403)',
    )

    step('a real super_admin still reads /admin/instance and gets a real 404 for junk paths')
    const asAdmin = await fetch(`${server.baseUrl}/api/v1/admin/instance`, {
      headers: { cookie: adminCookie },
    })
    assertEqual(asAdmin.status, 200, 'super_admin GET /admin/instance')
    const admin404 = await fetch(`${server.baseUrl}/api/v1/admin/does-not-exist`, {
      headers: { cookie: adminCookie },
    })
    assertEqual(admin404.status, 404, 'super_admin GET /admin/does-not-exist')

    step('matching audit rows for each denial')
    const auditClient = new Client({ connectionString: db.superuserUrl })
    await auditClient.connect()
    try {
      const { rows } = await auditClient.query<{ action: string; subject_id: string }>(
        `select action, subject_id from audit.events where action = 'access.denied' order by seq`,
      )
      console.log(`  audit.events rows: ${JSON.stringify(rows)}`)
      assertTrue(rows.length >= 3, 'at least 3 access.denied rows (one per break attempt above)')
      assertTrue(
        rows.every((r) => r.subject_id?.includes('/api/v1/admin/')),
        'every denial row names the admin route',
      )
    } finally {
      await auditClient.end()
    }

    console.log('\nadmin:prove PASSED')
  } finally {
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error('\nadmin:prove FAILED')
  console.error(err)
  process.exit(1)
})

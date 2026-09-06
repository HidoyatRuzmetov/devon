// AC-12 evidence producer (design.md §9): "first boot, consume, replay 410, second boot silent" --
// against a real, freshly migrated Postgres (test/checks/pg-fixture.ts), not the in-memory fake.
//
// Extended with the setup-created admin's 2FA lifecycle (enrol → verify → challenge login), because
// `consumeSetupToken` used to create the `app.users` row without its `app.user_security` twin: enrol
// answered 200 (its UPDATE matched zero rows) and verify could never succeed. Also proves the enrol
// upsert for a legacy account whose `app.user_security` row is missing.
import { Client } from 'pg'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'
import { totpAt } from '../../src/modules/accounts/totp.js'

const ADMIN_LOGIN = 'prove.admin'
const PASSWORD = 'Str0ngExampleValue123'

/** A 6-digit code that matches none of the ±1-step window the server accepts right now. */
function wrongTotpCode(secret: string): string {
  const now = Date.now()
  const valid = new Set([-30_000, 0, 30_000].map((d) => totpAt(secret, new Date(now + d))))
  let candidate = (Number(totpAt(secret, new Date(now))) + 1) % 1_000_000
  while (valid.has(String(candidate).padStart(6, '0'))) candidate = (candidate + 1) % 1_000_000
  return String(candidate).padStart(6, '0')
}

async function main(): Promise<void> {
  step('starting a fresh, migrated Postgres (Testcontainers)')
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  console.log(`  api listening at ${server.baseUrl}`)
  const pg = new Client({ connectionString: db.superuserUrl })
  await pg.connect()

  const api = (path: string) => `${server.baseUrl}/api/v1${path}`
  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(api(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const securityRow = async (login: string) => {
    const res = await pg.query<{ totp_enabled: boolean; failed_login_count: number }>(
      `select s.totp_enabled, s.failed_login_count
         from app.user_security s join app.users u on u.id = s.user_id
        where u.login = $1`,
      [login],
    )
    return res.rows[0] ?? null
  }

  try {
    step('first boot: ensureSetupToken() with zero users')
    const issued = await server.deps.ensureSetupToken()
    assertTrue(issued !== null, 'a setup token was issued on first boot')
    console.log(
      `  issued token (truncated): ${issued!.token.slice(0, 12)}... expires ${issued!.expiresAt.toISOString()}`,
    )

    step('opening the printed URL creates the super admin')
    const consumeRes = await postJson(`/setup/${issued!.token}`, {
      login: ADMIN_LOGIN,
      password: PASSWORD,
      givenName: 'Aziz',
      familyName: 'Yusupov',
      locale: 'uz-Latn',
    })
    assertEqual(consumeRes.status, 201, 'POST /setup/{token} status')
    const created = (await consumeRes.json()) as { user: { role: string } }
    console.log(`  created user: ${JSON.stringify(created.user)}`)
    assertEqual(created.user.role, 'super_admin', 'created user role')

    step('the setup-created admin owns an app.user_security row (same transaction as the user)')
    const adminSecurity = await securityRow(ADMIN_LOGIN)
    assertTrue(adminSecurity !== null, 'app.user_security row exists for the setup-created admin')
    assertEqual(adminSecurity!.totp_enabled, false, 'totp_enabled before enrolment')

    step('replaying the SAME URL returns 410, forever')
    const replay1 = await postJson(`/setup/${issued!.token}`, {
      login: 'second.admin',
      password: PASSWORD,
      givenName: 'X',
      familyName: 'Y',
      locale: 'uz-Latn',
    })
    assertEqual(replay1.status, 410, 'replay #1 status')
    console.log(`  body: ${JSON.stringify(await replay1.json())}`)

    const replay2 = await postJson(`/setup/${issued!.token}`, {
      login: 'third.admin',
      password: PASSWORD,
      givenName: 'X',
      familyName: 'Y',
      locale: 'uz-Latn',
    })
    assertEqual(replay2.status, 410, 'replay #2 status')

    step('a restart with a super admin already present prints no further URL')
    const second = await server.deps.ensureSetupToken()
    assertTrue(second === null, 'ensureSetupToken() returns null once a super admin exists')

    step('the admin logs in with password only while 2FA is off')
    const login1 = await postJson('/auth/login', { login: ADMIN_LOGIN, password: PASSWORD })
    assertEqual(login1.status, 204, 'password-only login status')
    const adminCookies = parseCookies(login1.headers.getSetCookie())
    const adminHeaders = {
      cookie: cookieHeader(adminCookies),
      'x-csrf-token': adminCookies['devon_csrf'] ?? '',
    }

    step('POST /accounts/2fa/totp/enroll hands back a secret')
    const enrollRes = await fetch(api('/accounts/2fa/totp/enroll'), {
      method: 'POST',
      headers: adminHeaders,
    })
    assertEqual(enrollRes.status, 200, 'enroll status')
    const enrolled = (await enrollRes.json()) as { secret: string; otpauthUri: string }
    assertTrue(enrolled.secret.length > 0, 'enroll returned a secret')
    assertTrue(enrolled.otpauthUri.startsWith('otpauth://totp/'), 'enroll returned an otpauth URI')

    step('POST /accounts/2fa/totp/verify with the current code enables 2FA')
    const verifyRes = await postJson(
      '/accounts/2fa/totp/verify',
      { code: totpAt(enrolled.secret, new Date()) },
      adminHeaders,
    )
    assertEqual(verifyRes.status, 200, 'verify status')
    const verified = (await verifyRes.json()) as { recoveryCodes: string[] }
    assertEqual(verified.recoveryCodes.length, 8, 'recovery codes issued')
    const statusRes = await fetch(api('/accounts/2fa'), {
      headers: { cookie: adminHeaders.cookie },
    })
    assertEqual(statusRes.status, 200, 'GET /accounts/2fa status')
    assertEqual(((await statusRes.json()) as { ok: boolean }).ok, true, '2FA reported enabled')
    assertEqual((await securityRow(ADMIN_LOGIN))!.totp_enabled, true, 'totp_enabled after verify')

    step('a fresh password login now returns a challenge instead of a session')
    const login2 = await postJson('/auth/login', { login: ADMIN_LOGIN, password: PASSWORD })
    assertEqual(login2.status, 200, 'login-with-2fa status')
    const challenge = (await login2.json()) as { requires2fa: boolean; challengeToken: string }
    assertEqual(challenge.requires2fa, true, 'requires2fa')
    assertEqual(
      login2.headers.getSetCookie().length,
      0,
      'no session cookie before the second factor',
    )

    step('POST /accounts/2fa/login-verify with a wrong code is rejected and counted')
    const badVerify = await postJson('/accounts/2fa/login-verify', {
      challengeToken: challenge.challengeToken,
      code: wrongTotpCode(enrolled.secret),
    })
    assertEqual(badVerify.status, 401, 'wrong-code login-verify status')
    assertEqual(
      (await securityRow(ADMIN_LOGIN))!.failed_login_count,
      1,
      'failed_login_count recorded on the admin row',
    )

    step('POST /accounts/2fa/login-verify with the current code starts a session')
    const goodVerify = await postJson('/accounts/2fa/login-verify', {
      challengeToken: challenge.challengeToken,
      code: totpAt(enrolled.secret, new Date()),
    })
    assertEqual(goodVerify.status, 204, 'login-verify status')
    const twoFaCookies = parseCookies(goodVerify.headers.getSetCookie())
    assertTrue(Boolean(twoFaCookies['devon_sid']), 'login-verify set the session cookie')
    const me = await fetch(api('/me'), { headers: { cookie: cookieHeader(twoFaCookies) } })
    assertEqual(me.status, 200, 'GET /me with the 2FA session')
    console.log(`  GET /me: ${JSON.stringify(await me.json())}`)
    assertEqual(
      (await securityRow(ADMIN_LOGIN))!.failed_login_count,
      0,
      'failed_login_count reset after a successful second factor',
    )

    step('a legacy account with no app.user_security row can still enrol (upsert)')
    const registerRes = await postJson('/accounts/register', {
      login: 'legacy.user',
      password: PASSWORD,
      givenName: 'Legacy',
      familyName: 'User',
    })
    assertEqual(registerRes.status, 201, 'register status')
    const registered = (await registerRes.json()) as { user: { id: string } }
    const deleted = await pg.query('delete from app.user_security where user_id = $1', [
      registered.user.id,
    ])
    assertEqual(deleted.rowCount, 1, 'legacy simulation: user_security row removed')
    const legacyCookies = parseCookies(registerRes.headers.getSetCookie())
    const legacyHeaders = {
      cookie: cookieHeader(legacyCookies),
      'x-csrf-token': legacyCookies['devon_csrf'] ?? '',
    }
    const legacyEnroll = await fetch(api('/accounts/2fa/totp/enroll'), {
      method: 'POST',
      headers: legacyHeaders,
    })
    assertEqual(legacyEnroll.status, 200, 'legacy enroll status')
    const legacySecret = ((await legacyEnroll.json()) as { secret: string }).secret
    const legacyVerify = await postJson(
      '/accounts/2fa/totp/verify',
      { code: totpAt(legacySecret, new Date()) },
      legacyHeaders,
    )
    assertEqual(legacyVerify.status, 200, 'legacy verify status')
    assertEqual((await securityRow('legacy.user'))!.totp_enabled, true, 'legacy totp_enabled')

    console.log('\nsetup:prove PASSED')
  } finally {
    await pg.end()
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error('\nsetup:prove FAILED')
  console.error(err)
  process.exit(1)
})

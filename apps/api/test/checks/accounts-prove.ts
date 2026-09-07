// Regression evidence for the `Tx.raw()` timestamp boundary in `modules/accounts/repo.ts` -- against a
// real Postgres, because this class of bug is invisible to the `unit` gate by construction: the
// in-memory `Deps` fake never hands a handler wire-format text where a `Date` was expected; only
// drizzle's node-postgres driver does (`packages/db/src/context.ts`'s `reviveTimestamps` is the fix
// this proves). Drives, end to end over HTTP: register -> TOTP enrol -> verify -> 2FA login challenge
// -> login-verify (wrong code, right code, replayed challenge, expired challenge, locked account,
// recovery code, reused recovery code) and delete-request -> delete/status -> cancel. Before the fix
// every login-verify was a 500 (`expires_at.getTime is not a function`) and delete/status was a 500
// once a request existed.
import { Client } from 'pg'
import { totpAt } from '../../src/modules/accounts/totp.js'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'

const LOGIN = 'twofa.prove'
const PASSWORD = 'Str0ngExampleValue123' // example, ephemeral Testcontainers instance only
const TOTP_STEP_MS = 30_000
const DAY_MS = 24 * 60 * 60 * 1000

type Session = { cookie: string; csrf: string }

function sessionFromResponse(res: Response, label: string): Session {
  const cookies = parseCookies(res.headers.getSetCookie())
  const csrf = cookies['devon_csrf']
  if (!cookies['devon_sid'] || !csrf)
    throw new Error(`${label}: no session cookies (${res.status})`)
  return { cookie: cookieHeader(cookies), csrf }
}

/** A 6-digit code `verifyTotp` will NOT accept for `secret` around `at` (its +-1 step window), so the
 * negative case can never pass by a 3-in-a-million accident. */
function wrongCodeFor(secret: string, at: Date): string {
  const accepted = new Set(
    [-1, 0, 1].map((delta) => totpAt(secret, new Date(at.getTime() + delta * TOTP_STEP_MS))),
  )
  let candidate = 0
  while (accepted.has(String(candidate).padStart(6, '0'))) candidate += 1
  return String(candidate).padStart(6, '0')
}

async function main(): Promise<void> {
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  const base = server.baseUrl
  console.log(`api listening at ${base}`)

  // Direct DB writes to set up the two time-based states (an expired challenge, a locked account) that
  // the API deliberately offers no endpoint for -- the same direct-write technique admin-prove.ts uses
  // to seed a member.
  const su = new Client({ connectionString: db.superuserUrl })
  await su.connect()

  function post(path: string, session: Session | null, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {}
    if (session) {
      headers['cookie'] = session.cookie
      headers['x-csrf-token'] = session.csrf
    }
    if (body === undefined) return fetch(`${base}${path}`, { method: 'POST', headers })
    headers['content-type'] = 'application/json'
    return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  }
  function get(path: string, session: Session): Promise<Response> {
    return fetch(`${base}${path}`, { headers: { cookie: session.cookie } })
  }
  async function loginChallenge(): Promise<string> {
    const res = await post('/api/v1/auth/login', null, { login: LOGIN, password: PASSWORD })
    assertEqual(res.status, 200, 'POST /auth/login with 2FA on answers 200 (a challenge), not 204')
    const body = (await res.json()) as { requires2fa: boolean; challengeToken: string }
    assertTrue(body.requires2fa && body.challengeToken.length > 0, 'challenge token issued')
    assertTrue(
      !res.headers.getSetCookie().some((c) => c.startsWith('devon_sid=')),
      'no session cookie before the second factor',
    )
    return body.challengeToken
  }
  async function loginVerify(challengeToken: string, code: string): Promise<Response> {
    const res = await post('/api/v1/accounts/2fa/login-verify', null, { challengeToken, code })
    const detail = res.status === 204 ? '' : ` ${await res.clone().text()}`
    console.log(`  POST /accounts/2fa/login-verify -> ${res.status}${detail}`)
    return res
  }

  try {
    step(
      'register through POST /accounts/register (the path that creates the app.user_security row)',
    )
    const registerRes = await post('/api/v1/accounts/register', null, {
      login: LOGIN,
      password: PASSWORD,
      givenName: 'Malika',
      familyName: 'Karimova',
      locale: 'uz-Latn',
    })
    assertEqual(registerRes.status, 201, 'register status')
    const registered = (await registerRes.json()) as { user: { id: string; login: string } }
    const userId = registered.user.id
    const first = sessionFromResponse(registerRes, 'register')

    step('2FA is off for a fresh account')
    const offRes = await get('/api/v1/accounts/2fa', first)
    assertEqual(offRes.status, 200, 'GET /accounts/2fa status')
    assertEqual(((await offRes.json()) as { ok: boolean }).ok, false, '2fa enabled before enrol')

    step('POST /accounts/2fa/totp/enroll, then /verify with a live code from the returned secret')
    const enrollRes = await post('/api/v1/accounts/2fa/totp/enroll', first)
    assertEqual(enrollRes.status, 200, 'enroll status')
    const { secret, otpauthUri } = (await enrollRes.json()) as {
      secret: string
      otpauthUri: string
    }
    assertTrue(otpauthUri.startsWith('otpauth://totp/'), 'otpauth uri shape')
    const verifyRes = await post('/api/v1/accounts/2fa/totp/verify', first, {
      code: totpAt(secret, new Date()),
    })
    assertEqual(verifyRes.status, 200, 'enrol verify status')
    const { recoveryCodes } = (await verifyRes.json()) as { recoveryCodes: string[] }
    assertEqual(recoveryCodes.length, 8, 'recovery codes issued')
    const onRes = await get('/api/v1/accounts/2fa', first)
    assertEqual(((await onRes.json()) as { ok: boolean }).ok, true, '2fa enabled after verify')

    step('login-verify: a wrong code is refused (reads expires_at and locked_until through raw())')
    const challengeA = await loginChallenge()
    const wrong = await loginVerify(challengeA, wrongCodeFor(secret, new Date()))
    assertEqual(wrong.status, 401, 'wrong code status')

    step('login-verify: the right code starts a session, and that session authenticates GET /me')
    const right = await loginVerify(challengeA, totpAt(secret, new Date()))
    assertEqual(right.status, 204, 'right code status')
    const second = sessionFromResponse(right, 'login-verify')
    const me = await get('/api/v1/me', second)
    assertEqual(me.status, 200, 'GET /me with the 2FA session')
    assertEqual(
      ((await me.json()) as { user: { login: string } }).user.login,
      LOGIN,
      'GET /me login',
    )

    step('login-verify: a consumed challenge cannot be replayed')
    const replay = await loginVerify(challengeA, totpAt(secret, new Date()))
    assertEqual(replay.status, 401, 'replayed challenge status')

    step(
      'login-verify: an expired challenge is refused (expires_at compared as an instant, not text)',
    )
    const challengeB = await loginChallenge()
    await su.query(
      `update app.login_challenges set expires_at = now() - interval '1 minute'
       where user_id = $1 and consumed_at is null`,
      [userId],
    )
    const expired = await loginVerify(challengeB, totpAt(secret, new Date()))
    assertEqual(expired.status, 401, 'expired challenge status')

    step('login-verify: a locked account is refused with 429 (locked_until compared as an instant)')
    const challengeC = await loginChallenge()
    await su.query(
      `update app.user_security set locked_until = now() + interval '15 minutes' where user_id = $1`,
      [userId],
    )
    const locked = await loginVerify(challengeC, totpAt(secret, new Date()))
    assertEqual(locked.status, 429, 'locked account status')
    await su.query(`update app.user_security set locked_until = null where user_id = $1`, [userId])

    step('login-verify: a recovery code works exactly once')
    const recovery = await loginVerify(challengeC, recoveryCodes[0]!)
    assertEqual(recovery.status, 204, 'recovery code status')
    const challengeD = await loginChallenge()
    const reused = await loginVerify(challengeD, recoveryCodes[0]!)
    assertEqual(reused.status, 401, 'reused recovery code status')

    step(
      'account deletion: status null -> request -> status echoes scheduled_for -> cancel -> null',
    )
    const none = await get('/api/v1/accounts/delete/status', second)
    assertEqual(none.status, 200, 'GET /delete/status with nothing pending')
    assertEqual(await none.text(), 'null', 'nothing pending body')
    const requested = await post('/api/v1/accounts/delete', second)
    assertEqual(requested.status, 200, 'POST /delete status')
    const { scheduledFor } = (await requested.json()) as { scheduledFor: string }
    const daysOut = (new Date(scheduledFor).getTime() - Date.now()) / DAY_MS
    console.log(`  scheduledFor: ${scheduledFor} (${daysOut.toFixed(3)} days out)`)
    assertTrue(daysOut > 29.99 && daysOut < 30.01, 'scheduled 30 days out')
    const pending = await get('/api/v1/accounts/delete/status', second)
    const pendingBody = await pending.text()
    console.log(`  GET /accounts/delete/status -> ${pending.status} ${pendingBody}`)
    assertEqual(pending.status, 200, 'GET /delete/status with a pending request')
    assertEqual(
      (JSON.parse(pendingBody) as { scheduledFor: string }).scheduledFor,
      scheduledFor,
      'delete/status echoes the exact scheduled instant (a timestamptz read back through raw())',
    )
    const cancel = await post('/api/v1/accounts/delete/cancel', second)
    assertEqual(cancel.status, 204, 'POST /delete/cancel status')
    const after = await get('/api/v1/accounts/delete/status', second)
    assertEqual(await after.text(), 'null', 'nothing pending after cancel')

    console.log('\naccounts:prove PASSED')
  } finally {
    await su.end()
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error('\naccounts:prove FAILED')
  console.error(err)
  process.exit(1)
})

// Telegram module evidence producer (mirrors `work-prove.ts`'s pattern): personal link codes,
// department group connect codes and group kinds, end to end against a real migrated Postgres (the
// real `0601_telegram.sql`, the real `createRepo()`, the real routes). The bot-side entry points
// (`consumeLinkCode` / `consumeGroupConnectCode` -- what `/start <code>` and `/connect <code>` call
// in `bot.ts`) are driven directly, since no Telegram server is involved.
//
// Exists because two classes of bug in `modules/telegram/repo.ts` are invisible to the unit suite
// and only a real Postgres can catch them:
//   1. `Tx.raw()` rows whose timestamptz columns (`expires_at`, `linked_at`, `muted_until`,
//      `connected_at`) are typed `Date` and then have `.getTime()` / `.toISOString()` called on them.
//      That is only true because `packages/db/src/context.ts`'s `reviveTimestamps` converts exactly
//      the columns `pg`'s field metadata says are timestamp-shaped -- every step below that reads an
//      ISO timestamp back, or gets `expired` from a past `expires_at`, proves that revival is live.
//   2. Binding a JS array into a `sql` template: drizzle expands a bare array to a `($1, $2)` value
//      list (a record), never one `text[]` parameter, so `setGroupKinds` must go through
//      `sql.param(kinds)` -- the two-kinds / one-kind / no-kinds PATCHes below each fail loudly
//      against a real server if that regresses ("expression is of type record", "malformed array
//      literal", or a syntax error, respectively).
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'
import {
  consumeGroupConnectCode,
  consumeLinkCode,
  issueLinkCode,
  listGroupsForKind,
  resolveGroupByChatId,
  resolveTelegramChatId,
  setMutedUntil,
} from '../../src/modules/telegram/repo.js'

const PASSWORD = 'Str0ngExampleValue123'
// Shapes Telegram actually sends: a positive id for a private chat, a `-100…` id for a supergroup.
const PERSONAL_CHAT_ID = '123456789'
const GROUP_CHAT_ID = '-1001234567890'

type LinkStatus = { linked: boolean; linkedAt: string | null; mutedUntil: string | null }
type Group = {
  id: string
  chatId: string
  title: string | null
  kinds: string[]
  connectedAt: string
}

function isIsoTimestamp(value: string | null): boolean {
  return value !== null && !Number.isNaN(Date.parse(value))
}

/** Backdates a code the same way the clock would, without waiting: the repo's own `expires_at` vs
 * `now()` comparison is what is under test, not the TTL arithmetic. Superuser connection (bypasses
 * RLS by design, see `pg-fixture.ts`) because `devon_app` has no reason to be able to do this. */
async function expireCode(
  superuserUrl: string,
  table: 'telegram_link_codes' | 'telegram_group_connect_codes',
  code: string,
): Promise<void> {
  const superuser = new Client({ connectionString: superuserUrl })
  await superuser.connect()
  try {
    await superuser.query(
      `update app.${table} set expires_at = now() - interval '1 minute' where code = $1`,
      [code],
    )
  } finally {
    await superuser.end()
  }
}

async function main(): Promise<void> {
  const db = await startProveDatabase()
  // Test mode never contacts Telegram; the routes still require configured transport credentials.
  const server = await startProveServer(db, { TELEGRAM_BOT_TOKEN: '123456:dummy-test-token' })
  console.log(`api listening at ${server.baseUrl}`)

  try {
    step('bootstrap: create a user via setup, then attach a department + head membership by hand')
    const issued = await server.deps.ensureSetupToken()
    const setupRes = await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'telegram.prove',
        password: PASSWORD,
        givenName: 'Dilnoza',
        familyName: 'Rahimova',
        locale: 'uz-Latn',
      }),
    })
    assertEqual(setupRes.status, 201, 'setup status')
    const { user } = (await setupRes.json()) as { user: { id: string } }

    const departmentId = randomUUID()
    const otherUserId = randomUUID()
    const foreignDepartmentId = randomUUID()
    const foreignGroupId = randomUUID()
    const superuser = new Client({ connectionString: db.superuserUrl })
    await superuser.connect()
    try {
      await superuser.query(`update app.users set role = 'member' where id = $1`, [user.id])
      await superuser.query(
        `insert into app.users (id, login, password_hash, given_name, family_name)
         select $1, 'telegram.other', password_hash, 'Other', 'User' from app.users where id = $2`,
        [otherUserId, user.id],
      )
      await superuser.query(
        `insert into app.departments (id, name, slug) values ($1, 'Axborot texnologiyalari boshqarmasi', 'axborot-texnologiyalari')`,
        [departmentId],
      )
      await superuser.query(
        `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, 'head')`,
        [randomUUID(), departmentId, user.id],
      )
      await superuser.query(
        `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, 'member')`,
        [randomUUID(), departmentId, otherUserId],
      )
      await superuser.query(
        `insert into app.departments (id, name, slug) values ($1, 'Other department', $2)`,
        [foreignDepartmentId, `foreign-${foreignDepartmentId}`],
      )
      await superuser.query(
        `insert into app.telegram_groups (id, department_id, chat_id, title, kinds) values ($1, $2, -1008888888888, 'Other department group', '{events}')`,
        [foreignGroupId, foreignDepartmentId],
      )
    } finally {
      await superuser.end()
    }

    step('POST /api/v1/auth/login')
    const loginRes = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'telegram.prove', password: PASSWORD }),
    })
    assertEqual(loginRes.status, 204, 'login status')
    const cookies = parseCookies(loginRes.headers.getSetCookie())
    const cookie = cookieHeader(cookies)
    const csrf = cookies['devon_csrf']!
    const csrfHeaders = { cookie, 'x-csrf-token': csrf }
    // Only a request that carries a body may say so: Fastify rejects an empty JSON body outright.
    const headers = { ...csrfHeaders, 'content-type': 'application/json' }

    const getStatus = async (): Promise<LinkStatus> => {
      const res = await fetch(`${server.baseUrl}/api/v1/telegram/status`, { headers: { cookie } })
      assertEqual(res.status, 200, 'GET /telegram/status status')
      return (await res.json()) as LinkStatus
    }
    const listGroups = async (): Promise<Group[]> => {
      const res = await fetch(
        `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/groups`,
        { headers: { cookie } },
      )
      assertEqual(res.status, 200, 'GET /telegram/departments/:id/groups status')
      return ((await res.json()) as { items: Group[] }).items
    }

    step('POST /telegram/link-code issues a code; GET /telegram/status is not linked yet')
    const linkCodeRes = await fetch(`${server.baseUrl}/api/v1/telegram/link-code`, {
      method: 'POST',
      headers: csrfHeaders,
    })
    assertEqual(linkCodeRes.status, 200, 'link-code status')
    const linkCode = (await linkCodeRes.json()) as { code: string; expiresAt: string }
    assertTrue(isIsoTimestamp(linkCode.expiresAt), 'link code expiresAt is an ISO timestamp')
    assertEqual((await getStatus()).linked, false, 'not linked before /start')

    step('consumeLinkCode: valid, idempotent same-chat retry, refused other-chat replay, not_found')
    const linked = await consumeLinkCode(linkCode.code, PERSONAL_CHAT_ID, 'uz-Latn')
    assertEqual(linked.ok ? linked.userId : linked.reason, user.id, 'valid code links the issuer')
    const again = await consumeLinkCode(linkCode.code, PERSONAL_CHAT_ID, 'uz-Latn')
    assertEqual(again.ok ? 'ok' : again.reason, 'ok', 'same-chat delivery retry is idempotent')
    const stolen = await consumeLinkCode(
      linkCode.code,
      String(Number(PERSONAL_CHAT_ID) + 1),
      'uz-Latn',
    )
    assertEqual(
      stolen.ok ? 'ok' : stolen.reason,
      'already_used',
      'another chat cannot reuse a consumed code',
    )
    const unknown = await consumeLinkCode('NOSUCHCD', PERSONAL_CHAT_ID, 'uz-Latn')
    assertEqual(unknown.ok ? 'ok' : unknown.reason, 'not_found', 'unknown code')

    step(
      'an already-linked chat refuses another account without consuming its code or blocking retries',
    )
    const otherCode = await issueLinkCode(otherUserId)
    const conflict = await consumeLinkCode(otherCode.code, PERSONAL_CHAT_ID, 'uz-Latn')
    assertEqual(
      conflict.ok ? 'ok' : conflict.reason,
      'chat_in_use',
      'another account cannot take over this chat',
    )
    assertEqual(
      await resolveTelegramChatId(user.id),
      PERSONAL_CHAT_ID,
      'original account link is preserved',
    )
    const otherChat = await consumeLinkCode(
      otherCode.code,
      String(Number(PERSONAL_CHAT_ID) + 2),
      'en',
    )
    assertEqual(
      otherChat.ok ? otherChat.userId : otherChat.reason,
      otherUserId,
      'refused attempt rolls back code consumption',
    )

    step(
      'GET /telegram/status after linking: linkedAt is a real timestamp (linked_at -> Date -> ISO)',
    )
    const after = await getStatus()
    assertEqual(after.linked, true, 'linked')
    assertTrue(isIsoTimestamp(after.linkedAt), 'linkedAt is an ISO timestamp')
    assertEqual(after.mutedUntil, null, 'mutedUntil is null')
    assertEqual(await resolveTelegramChatId(user.id), PERSONAL_CHAT_ID, 'resolveTelegramChatId')

    step('expired link code: expires_at in the past -> expired (expires_at -> Date.getTime())')
    const expiredCode = await issueLinkCode(user.id)
    await expireCode(db.superuserUrl, 'telegram_link_codes', expiredCode.code)
    const expired = await consumeLinkCode(expiredCode.code, PERSONAL_CHAT_ID, 'uz-Latn')
    assertEqual(expired.ok ? 'ok' : expired.reason, 'expired', 'expired code')

    step(
      'POST /telegram/mute: mutedUntil is a timestamp and delivery resolves no chat; unmute restores',
    )
    const muteRes = await fetch(`${server.baseUrl}/api/v1/telegram/mute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ minutes: 30 }),
    })
    assertEqual(muteRes.status, 204, 'mute status')
    const muted = await getStatus()
    assertTrue(
      isIsoTimestamp(muted.mutedUntil) && Date.parse(muted.mutedUntil!) > Date.now(),
      'mutedUntil is an ISO timestamp in the future',
    )
    assertEqual(await resolveTelegramChatId(user.id), null, 'muted user resolves to no chat id')
    await setMutedUntil(user.id, null)
    assertEqual(
      await resolveTelegramChatId(user.id),
      PERSONAL_CHAT_ID,
      'unmuted user resolves again',
    )

    step("POST /telegram/departments/:id/connect-code (head), then the bot's /connect <code>")
    const connectRes = await fetch(
      `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/connect-code`,
      { method: 'POST', headers: csrfHeaders },
    )
    assertEqual(connectRes.status, 200, 'connect-code status')
    const connectCode = (await connectRes.json()) as { code: string; expiresAt: string }
    assertTrue(isIsoTimestamp(connectCode.expiresAt), 'connect code expiresAt is an ISO timestamp')
    const connected = await consumeGroupConnectCode(
      connectCode.code,
      GROUP_CHAT_ID,
      'Boshqarma guruhi',
      user.id,
    )
    assertEqual(
      connected.ok ? connected.departmentId : connected.reason,
      departmentId,
      'valid connect code resolves to the department',
    )
    const connectedAgain = await consumeGroupConnectCode(
      connectCode.code,
      GROUP_CHAT_ID,
      null,
      null,
    )
    assertEqual(
      connectedAgain.ok ? 'ok' : connectedAgain.reason,
      'already_used',
      'second use of the same connect code',
    )
    const connectUnknown = await consumeGroupConnectCode('NOSUCHCD', GROUP_CHAT_ID, null, null)
    assertEqual(
      connectUnknown.ok ? 'ok' : connectUnknown.reason,
      'not_found',
      'unknown connect code',
    )

    step('expired connect code -> expired')
    const expiredConnectRes = await fetch(
      `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/connect-code`,
      { method: 'POST', headers: csrfHeaders },
    )
    assertEqual(expiredConnectRes.status, 200, 'second connect-code status')
    const expiredConnect = (await expiredConnectRes.json()) as { code: string }
    await expireCode(db.superuserUrl, 'telegram_group_connect_codes', expiredConnect.code)
    const connectExpired = await consumeGroupConnectCode(
      expiredConnect.code,
      '-1009999999999',
      null,
      null,
    )
    assertEqual(connectExpired.ok ? 'ok' : connectExpired.reason, 'expired', 'expired connect code')

    step('GET /telegram/departments/:id/groups: default notifications and a real connectedAt')
    const groups = await listGroups()
    assertEqual(groups.length, 1, 'one connected group')
    const group = groups[0]!
    assertEqual(group.chatId, GROUP_CHAT_ID, 'group chat id')
    assertEqual(group.title, 'Boshqarma guruhi', 'group title')
    assertEqual(
      JSON.stringify([...group.kinds].sort()),
      JSON.stringify(['announcements', 'events', 'polls']),
      'fresh group enables useful default notifications',
    )
    assertTrue(isIsoTimestamp(group.connectedAt), 'connectedAt is an ISO timestamp')

    step('PATCH group kinds: two kinds, one kind, none -- each bound as a single text[] parameter')
    const setKinds = async (kinds: string[]): Promise<void> => {
      const label = JSON.stringify(kinds)
      const res = await fetch(
        `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/groups/${group.id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ kinds }) },
      )
      assertEqual(res.status, 204, `PATCH kinds=${label} status`)
      const [stored] = await listGroups()
      assertEqual(
        JSON.stringify(stored!.kinds),
        label,
        `kinds=${label} round-trips through the list`,
      )
    }
    await setKinds(['events', 'polls'])
    const resolved = await resolveGroupByChatId(GROUP_CHAT_ID)
    assertEqual(
      JSON.stringify(resolved?.kinds),
      JSON.stringify(['events', 'polls']),
      'resolveGroupByChatId sees the kinds',
    )
    const forEvents = await listGroupsForKind('events')
    assertTrue(
      forEvents.some((g) => g.chatId === GROUP_CHAT_ID && g.departmentId === departmentId),
      'listGroupsForKind(events) includes the group',
    )
    const lifecycle = new Client({ connectionString: db.superuserUrl })
    await lifecycle.connect()
    try {
      await lifecycle.query(`update app.departments set status = 'paused_by_admin' where id = $1`, [
        departmentId,
      ])
      assertTrue(
        !(await listGroupsForKind('events')).some((g) => g.departmentId === departmentId),
        'paused departments do not broadcast',
      )
      await lifecycle.query(
        `update app.departments set status = 'active', deleted_at = now() where id = $1`,
        [departmentId],
      )
      assertTrue(
        !(await listGroupsForKind('events')).some((g) => g.departmentId === departmentId),
        'deleted departments do not broadcast',
      )
      await lifecycle.query(`update app.departments set deleted_at = null where id = $1`, [
        departmentId,
      ])
      assertTrue(
        (await listGroupsForKind('events')).some((g) => g.departmentId === departmentId),
        'resumed active departments broadcast again',
      )
    } finally {
      await lifecycle.end()
    }
    await setKinds(['deadlines'])
    await setKinds([])
    const forEventsAfter = await listGroupsForKind('events')
    assertTrue(
      !forEventsAfter.some((g) => g.chatId === GROUP_CHAT_ID),
      'listGroupsForKind(events) no longer includes the group',
    )

    step('group mutations cannot change another department’s global group row')
    const foreignPath = `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/groups/${foreignGroupId}`
    await fetch(foreignPath, { method: 'PATCH', headers, body: JSON.stringify({ kinds: [] }) })
    await fetch(foreignPath, { method: 'DELETE', headers: csrfHeaders })
    const isolated = new Client({ connectionString: db.superuserUrl })
    await isolated.connect()
    try {
      const stored = await isolated.query<{ kinds: string[]; disconnected_at: Date | null }>(
        'select kinds, disconnected_at from app.telegram_groups where id = $1',
        [foreignGroupId],
      )
      assertEqual(
        JSON.stringify(stored.rows[0]!.kinds),
        JSON.stringify(['events']),
        'foreign group kinds are unchanged',
      )
      assertEqual(stored.rows[0]!.disconnected_at, null, 'foreign group remains connected')
    } finally {
      await isolated.end()
    }

    step('member connection policy is enforced in both status and connect-code endpoint')
    const memberLogin = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'telegram.other', password: PASSWORD }),
    })
    assertEqual(memberLogin.status, 204, 'member login')
    const memberCookies = parseCookies(memberLogin.headers.getSetCookie())
    const memberHeaders = {
      cookie: cookieHeader(memberCookies),
      'x-csrf-token': memberCookies['devon_csrf']!,
    }
    const memberStatus = async () => {
      const res = await fetch(`${server.baseUrl}/api/v1/telegram/status`, {
        headers: memberHeaders,
      })
      assertEqual(res.status, 200, 'member Telegram status')
      return (await res.json()) as { canConnectGroup: boolean }
    }
    assertEqual((await memberStatus()).canConnectGroup, true, 'everyone policy permits members')
    const allowed = await fetch(
      `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/connect-code`,
      { method: 'POST', headers: memberHeaders },
    )
    assertEqual(allowed.status, 200, 'permitted member obtains a connection code')
    const settings = new Client({ connectionString: db.superuserUrl })
    await settings.connect()
    try {
      await settings.query(
        `update app.departments set settings = jsonb_set(settings, '{whoCanConnectTelegramGroup}', '"head"') where id = $1`,
        [departmentId],
      )
    } finally {
      await settings.end()
    }
    assertEqual((await memberStatus()).canConnectGroup, false, 'head policy hides member action')
    const denied = await fetch(
      `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/connect-code`,
      { method: 'POST', headers: memberHeaders },
    )
    assertEqual(denied.status, 403, 'head-only policy refuses a member')
    const headAllowed = await fetch(
      `${server.baseUrl}/api/v1/telegram/departments/${departmentId}/connect-code`,
      { method: 'POST', headers: csrfHeaders },
    )
    assertEqual(headAllowed.status, 200, 'head remains authorized under head-only policy')

    console.log('\ntelegram:prove PASSED')
  } finally {
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})

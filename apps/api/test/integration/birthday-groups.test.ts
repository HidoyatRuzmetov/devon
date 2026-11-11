import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { processGroupBirthdays } from '../../src/modules/birthdays/group-worker.js'
import type { SendResult } from '../../src/modules/telegram/transport.js'
import {
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'

let db: Db, server: Server
let chatSequence = -70000
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

const publicGreeting = {
  message:
    'May the coming year bring exciting new discoveries and plenty of time for the books you love.',
  source: 'ai' as const,
}
const prepare = async () => publicGreeting
const configured = () => true
const successfulSend = () =>
  vi.fn(async (_chat: string, _text: string): Promise<SendResult> => ({ ok: true, messageId: 91 }))

async function department() {
  const dept = await seedDepartment(db, { name: 'Birthday group QA', slug: randomUUID() })
  await seedMember(db, dept.id, { role: 'head' })
  return dept.id
}
async function group(departmentId: string, kinds = ['announcements'], disconnected = false) {
  const chat = String(--chatSequence)
  await superuserQuery(
    db,
    'insert into app.telegram_groups(department_id,chat_id,kinds,disconnected_at) values($1,$2,$3,case when $4 then now() end)',
    [departmentId, chat, kinds, disconnected],
  )
  return chat
}
async function celebrant(departmentId: string, date: string, givenName = 'Dilnoza') {
  const owner = await seedMember(db, departmentId, { role: 'member' })
  await superuserQuery(db, 'update app.users set given_name=$2,family_name=$3 where id=$1', [
    owner.id,
    givenName,
    'Olimova',
  ])
  await superuserQuery(
    db,
    'insert into app.account_birthdays(owner_user_id,birth_date) values($1,$2::date)',
    [owner.id, date],
  )
  return owner.id
}
function receipts(owner: string) {
  return superuserQuery(
    db,
    'select chat_id::text as chat,status,attempts,telegram_message_id::text as receipt,celebration_year as year from app.telegram_birthday_deliveries where owner_user_id=$1 order by celebration_year,chat_id',
    [owner],
  )
}
function run(at: string, send: (chat: string, text: string) => Promise<SendResult>) {
  return processGroupBirthdays(send, configured, new Date(at), prepare)
}

it('starts on November 12 at 09:00 Tashkent and publishes each birthday once per subscribed chat and year', async () => {
  const dept = await department()
  const [firstChat, secondChat] = await Promise.all([group(dept), group(dept)])
  await Promise.all([
    group(dept, ['events']),
    group(dept, ['announcements'], true),
    group(await department()),
  ])
  const beforeLaunch = await celebrant(dept, '1994-11-11', 'Before launch')
  const dilnoza = await celebrant(dept, '1992-11-12')
  const aziza = await celebrant(dept, '1998-11-12', 'Aziza')
  const inactive = await celebrant(dept, '1990-11-12', 'Inactive')
  await superuserQuery(db, "update app.users set status='locked' where id=$1", [inactive])
  const send = successfulSend()
  // A previous deployment could have queued a greeting before the public launch.
  await superuserQuery(
    db,
    'insert into app.telegram_birthday_deliveries(department_id,owner_user_id,chat_id,celebration_date) values($1,$2,$3,$4)',
    [dept, beforeLaunch, firstChat, '2026-11-11'],
  )
  const prepareBeforeLaunch = vi.fn(prepare)
  const prelaunchTick = (at: string) =>
    processGroupBirthdays(send, configured, new Date(at), prepareBeforeLaunch)
  await prelaunchTick('2026-11-11T04:00:00Z')
  await prelaunchTick('2026-11-11T18:59:59Z')
  await prelaunchTick('2026-11-12T03:59:59Z')
  expect(prepareBeforeLaunch).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  await Promise.all([run('2026-11-12T04:00:00Z', send), run('2026-11-12T04:00:00Z', send)])
  expect(await receipts(beforeLaunch)).toEqual([
    expect.objectContaining({ chat: firstChat, status: 'pending', attempts: 0 }),
  ])
  // Reconnecting this chat creates a new group row, but its Telegram recipients are the same.
  await superuserQuery(
    db,
    'update app.telegram_groups set disconnected_at=now() where chat_id=$1',
    [firstChat],
  )
  await superuserQuery(
    db,
    "insert into app.telegram_groups(department_id,chat_id,kinds) values($1,$2,'{announcements}')",
    [dept, firstChat],
  )
  await run('2026-11-12T18:59:59Z', send)
  expect(send).toHaveBeenCalledTimes(4)
  for (const chat of [firstChat, secondChat]) {
    const messages = send.mock.calls
      .filter(([recipient]) => recipient === chat)
      .map(([, text]) => text)
    expect(messages).toHaveLength(2)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dilnoza'),
        expect.stringContaining('Aziza'),
      ]),
    )
    expect(messages.every((text) => text.includes(publicGreeting.message))).toBe(true)
    expect(messages.join(' ')).not.toMatch(/1992|1998|tomorrow/i)
  }
  for (const owner of [dilnoza, aziza]) {
    expect(await receipts(owner)).toEqual(
      [secondChat, firstChat].map((chat) => ({
        chat,
        status: 'sent',
        attempts: 1,
        receipt: '91',
        year: 2026,
      })),
    )
  }
  expect(await receipts(inactive)).toEqual([])
  await run('2027-11-12T04:05:00Z', send)
  expect(send).toHaveBeenCalledTimes(8)
  expect((await receipts(dilnoza)).map((row) => row['year'])).toEqual([2026, 2026, 2027, 2027])
})

it('catches up a missed morning on the same local birthday and skips a birthday that already ended', async () => {
  const dept = await department()
  const chat = await group(dept)
  await celebrant(dept, '1996-04-15', 'Today')
  const yesterday = await celebrant(dept, '1984-04-14', 'Yesterday')
  const send = successfulSend()
  await processGroupBirthdays(send, () => false, new Date('2040-04-15T04:00:00Z'), prepare)
  expect(send).not.toHaveBeenCalled()
  await run('2040-04-15T18:59:59Z', send)
  expect(send).toHaveBeenCalledExactlyOnceWith(chat, expect.stringContaining('Today'))
  expect(await receipts(yesterday)).toEqual([])
})

it('retries a known unsent rate limit and never replays an ambiguous send', async () => {
  const dept = await department()
  await group(dept)
  const owner = await celebrant(dept, '2000-02-29')
  const send = successfulSend()
    .mockResolvedValueOnce({ ok: false, error: '429: Too Many Requests' })
    .mockRejectedValueOnce(new Error('ETIMEDOUT'))
  // Feb 29 is observed on Feb 28 in this non-leap year.
  await run('2041-02-28T04:00:00Z', send)
  expect(await receipts(owner)).toEqual([
    expect.objectContaining({ status: 'pending', attempts: 1 }),
  ])
  await run('2041-02-28T04:01:00Z', send)
  expect(send).toHaveBeenCalledTimes(1)
  await run('2041-02-28T05:00:00Z', send)
  await run('2041-02-28T18:00:00Z', send)
  expect(send).toHaveBeenCalledTimes(2)
  expect(await receipts(owner)).toEqual([
    expect.objectContaining({ status: 'uncertain', attempts: 2, receipt: null }),
  ])
})

it('does not send a pending retry on the next civil day', async () => {
  const dept = await department()
  await group(dept)
  await celebrant(dept, '1997-08-18')
  const send = successfulSend().mockResolvedValueOnce({
    ok: false,
    error: '429: Too Many Requests',
  })
  await run('2040-08-18T18:59:00Z', send)
  await run('2040-08-19T04:00:00Z', send)
  expect(send).toHaveBeenCalledTimes(1)
})

it('rechecks group opt-out when preparing the wish races with a subscription change', async () => {
  const dept = await department()
  const chat = await group(dept)
  await celebrant(dept, '1996-09-15')
  const send = successfulSend()
  const unsubscribeWhilePreparing = vi.fn(async () => {
    await superuserQuery(db, "update app.telegram_groups set kinds='{}'::text[] where chat_id=$1", [
      chat,
    ])
    return publicGreeting
  })
  await processGroupBirthdays(
    send,
    configured,
    new Date('2040-09-15T05:00:00Z'),
    unsubscribeWhilePreparing,
  )
  expect(unsubscribeWhilePreparing).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalled()
})

it('waits for a usable personal greeting when AI fails before sending', async () => {
  const dept = await department()
  const chat = await group(dept)
  const owner = await celebrant(dept, '1991-07-18')
  const send = successfulSend()
  const provider = vi.fn(prepare).mockRejectedValueOnce(new Error('provider_unavailable'))
  await processGroupBirthdays(send, configured, new Date('2040-07-18T04:00:00Z'), provider)
  await processGroupBirthdays(send, configured, new Date('2040-07-18T04:04:00Z'), provider)
  expect(send).not.toHaveBeenCalled()
  expect(provider).toHaveBeenCalledOnce()
  expect(await receipts(owner)).toEqual([
    expect.objectContaining({ status: 'pending', receipt: null }),
  ])
  await processGroupBirthdays(send, configured, new Date('2040-07-18T04:05:00Z'), provider)
  expect(send).toHaveBeenCalledExactlyOnceWith(
    chat,
    expect.stringContaining(publicGreeting.message),
  )
})

it('does not send yesterday’s wish if AI finishes after local midnight', async () => {
  const dept = await department()
  await group(dept)
  await celebrant(dept, '1989-12-01')
  let now = new Date('2040-12-01T18:59:59Z')
  const send = successfulSend()
  const slowGreeting = vi.fn(async () => {
    now = new Date('2040-12-01T19:00:01Z')
    return publicGreeting
  })
  await processGroupBirthdays(send, configured, () => now, slowGreeting)
  expect(slowGreeting).toHaveBeenCalledOnce()
  expect(send).not.toHaveBeenCalled()
})

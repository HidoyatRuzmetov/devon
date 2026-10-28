import type { PersonalCalendarItem } from '@devon/contracts'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { processPersonalCalendarReminders } from '../../src/modules/personal/calendar-worker.js'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'
let db: Db,
  server: Server,
  owner: Awaited<ReturnType<typeof seedMember>>,
  head: Awaited<ReturnType<typeof seedMember>>,
  departmentId: string
let session: Session, other: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Personal calendar QA', slug: 'calendar-' + randomUUID() })
  ).id
  owner = await seedMember(db, departmentId, { role: 'member' })
  head = await seedMember(db, departmentId, { role: 'head' })
  session = await loginAs(server.baseUrl, owner.login)
  other = await loginAs(server.baseUrl, head.login)
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(path: string, method = 'GET', body?: unknown, actor = session) {
  const headers = { ...actor.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/personal/calendar${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const entry = () => ({
  title: 'Personal appointment ' + randomUUID(),
  notes: 'Only my account may read this',
  startsAt: '2027-04-05T09:00:00+05:00',
  endsAt: '2027-04-05T10:00:00+05:00',
  allDay: false,
  remindAt: null,
})
async function create() {
  const input = entry()
  const response = await request('', 'POST', input)
  expect(response.status, await response.clone().text()).toBe(201)
  return { id: ((await response.json()) as { id: string }).id, input }
}
const range = '?from=2027-04-01&to=2027-05-01'
describe('personal calendar privacy and delivery', () => {
  it('keeps owner entries private even from the head, rejects foreign writes and stale revisions', async () => {
    const { id, input } = await create()
    const listed = await request(range)
    expect(listed.status, await listed.clone().text()).toBe(200)
    expect(((await listed.json()) as PersonalCalendarItem[]).some((item) => item.id === id)).toBe(
      true,
    )
    expect(
      (
        (await (await request(range, 'GET', undefined, other)).json()) as PersonalCalendarItem[]
      ).some((item) => item.id === id),
    ).toBe(false)
    expect(
      (
        await request(
          '/' + id,
          'PATCH',
          { version: 1, entry: { ...input, title: 'Foreign overwrite' } },
          other,
        )
      ).status,
    ).toBe(409)
    expect((await request('/' + id + '?version=1', 'DELETE', undefined, other)).status).toBe(409)
    expect(
      (
        await request('/' + id, 'PATCH', {
          version: 1,
          entry: { ...input, title: 'Updated by owner' },
        })
      ).status,
    ).toBe(200)
    expect((await request('/' + id, 'PATCH', { version: 1, entry: input })).status).toBe(409)
    expect((await request('/' + id + '?version=2', 'DELETE')).status).toBe(204)
    expect(
      ((await (await request(range)).json()) as PersonalCalendarItem[]).some(
        (item) => item.id === id,
      ),
    ).toBe(false)
  })
  it('includes only assigned deadlines and signed-up events with distinct kinds', async () => {
    const ids = Array.from({ length: 5 }, () => randomUUID())
    await superuserQuery(
      db,
      "insert into app.cards(id,department_id,title,created_by_user_id,assignee_user_id,due_at) values($1,$3,'My task',$4,$4,'2027-04-05'),($2,$3,'Other task',$4,$5,'2027-04-05')",
      [ids[0], ids[1], departmentId, owner.id, head.id],
    )
    await superuserQuery(
      db,
      "insert into app.events(id,department_id,title,organizer_user_id,starts_at,ends_at) values($1,$4,'Going',$5,'2027-04-05','2027-04-06'),($2,$4,'Not signed up',$5,'2027-04-05','2027-04-06'),($3,$4,'Waitlist',$5,'2027-04-05','2027-04-06')",
      [ids[2], ids[3], ids[4], departmentId, head.id],
    )
    await superuserQuery(
      db,
      "insert into app.event_rsvps(department_id,event_id,user_id,status) values($1,$2,$4,'yes'),($1,$3,$4,'waitlist')",
      [departmentId, ids[2], ids[4], owner.id],
    )
    const list = (await (await request(range)).json()) as PersonalCalendarItem[]
    expect(list.find((i) => i.id === ids[0])?.kind).toBe('task')
    expect(list.find((i) => i.id === ids[1])).toBeUndefined()
    expect(list.find((i) => i.id === ids[2])?.kind).toBe('event')
    expect(list.find((i) => i.id === ids[3])).toBeUndefined()
    expect(list.find((i) => i.id === ids[4])?.status).toBe('waitlist')
  })
  it('validates dates, reminder order and bounded ranges', async () => {
    const { id, input } = await create()
    expect(
      (
        await request('/' + id, 'PATCH', {
          version: 1,
          entry: { ...input, remindAt: '2020-01-01T00:00:00Z' },
        })
      ).status,
    ).toBe(422)
    await superuserQuery(
      db,
      "update app.personal_calendar_entries set remind_at='2020-01-01T00:00:00Z' where id=$1",
      [id],
    )
    expect(
      (
        await request('/' + id, 'PATCH', {
          version: 1,
          entry: { ...input, title: 'Keep delivered reminder', remindAt: '2020-01-01T00:00:00Z' },
        })
      ).status,
    ).toBe(200)
    expect((await request('', 'POST', { ...entry(), endsAt: '2027-04-04T09:00:00Z' })).status).toBe(
      422,
    )
    expect(
      (await request('', 'POST', { ...entry(), remindAt: '2027-04-07T09:00:00Z' })).status,
    ).toBe(422)
    expect((await request('?from=2020-01-01&to=2030-01-01')).status).toBe(422)
  })
  it('sends due reminders once, excludes cancelled entries, and does not expose their private text', async () => {
    const { id } = await create(),
      cancelled = await create()
    await superuserQuery(
      db,
      "insert into app.telegram_links(user_id,chat_id,locale_at_link) values($1,991001,'en')",
      [owner.id],
    )
    await superuserQuery(
      db,
      "update app.personal_calendar_entries set remind_at=now()-interval '1 minute',version=version+1 where id=any($1::uuid[])",
      [[id, cancelled.id]],
    )
    expect((await request('/' + cancelled.id + '?version=2', 'DELETE')).status).toBe(204)
    const send = vi.fn(async (_chat: string, _text: string) => ({
      ok: true as const,
      messageId: 15,
    }))
    await processPersonalCalendarReminders(send, () => true)
    await processPersonalCalendarReminders(send, () => true)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0]).toBe('991001')
    expect(send.mock.calls[0]?.[1]).toContain(id)
    expect(send.mock.calls[0]?.[1]).not.toContain('Only my account')
    expect(
      await superuserQuery(
        db,
        'select entry_id from app.personal_calendar_reminders where entry_id=$1 and sent_at is not null',
        [id],
      ),
    ).toHaveLength(1)
  })
  it('reschedules reminders, respects mute, and retries failed delivery without duplicating a successful send', async () => {
    const { id } = await create()
    await superuserQuery(
      db,
      "update app.telegram_links set muted_until=now()+interval '1 hour' where user_id=$1",
      [owner.id],
    )
    await superuserQuery(
      db,
      "update app.personal_calendar_entries set remind_at=now()-interval '1 minute',version=version+1 where id=$1",
      [id],
    )
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'temporary' })
      .mockResolvedValue({ ok: true, messageId: 16 })
    await processPersonalCalendarReminders(send, () => false)
    await processPersonalCalendarReminders(send, () => true)
    expect(send).not.toHaveBeenCalled()
    await superuserQuery(db, 'update app.telegram_links set muted_until=null where user_id=$1', [
      owner.id,
    ])
    await superuserQuery(
      db,
      "update app.personal_calendar_reminders set lease_until=now()-interval '1 minute' where entry_id=$1",
      [id],
    )
    await processPersonalCalendarReminders(send, () => true)
    await processPersonalCalendarReminders(send, () => true)
    expect(send).toHaveBeenCalledTimes(1)
    await superuserQuery(
      db,
      "update app.personal_calendar_reminders set lease_until=now()-interval '1 minute' where entry_id=$1",
      [id],
    )
    await processPersonalCalendarReminders(send, () => true)
    await processPersonalCalendarReminders(send, () => true)
    expect(send).toHaveBeenCalledTimes(2)
    // Editing a title alone must not deliver the same reminder again.
    await superuserQuery(
      db,
      "update app.personal_calendar_entries set title='Changed title',version=version+1 where id=$1",
      [id],
    )
    await processPersonalCalendarReminders(send, () => true)
    expect(send).toHaveBeenCalledTimes(2)
    // A changed reminder is a new delivery, with the latest entry version.
    await superuserQuery(
      db,
      "update app.personal_calendar_entries set remind_at=now()-interval '2 minutes',version=version+1 where id=$1",
      [id],
    )
    await processPersonalCalendarReminders(send, () => true)
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.every((call) => String(call[1]).includes(id))).toBe(true)
  })
})

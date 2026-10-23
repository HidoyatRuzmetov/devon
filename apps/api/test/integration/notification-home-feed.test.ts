import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
let db: Db, server: Server, session: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, { name: 'Home inbox', slug: `home-${randomUUID()}` })
  const [viewer, other] = await Promise.all([
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, department.id, { role: 'member' }),
  ])
  session = await loginAs(server.baseUrl, viewer.login)
  const rows = [
    ...Array.from({ length: 31 }, (_, index) => ({
      id: randomUUID(),
      user_id: viewer.id,
      reason: 'assigned',
      subject_type: 'personal_task',
      read: index === 0,
      snoozed: index === 1,
    })),
    { id: randomUUID(), user_id: viewer.id, reason: 'updated', subject_type: 'event' },
    { id: randomUUID(), user_id: viewer.id, reason: 'digest', subject_type: 'digest' },
    { id: randomUUID(), user_id: viewer.id, reason: 'system', subject_type: 'system' },
    { id: randomUUID(), user_id: viewer.id, reason: 'rsvp', subject_type: 'event', archived: true },
    { id: randomUUID(), user_id: other.id, reason: 'system', subject_type: 'system' },
  ]
  await superuserQuery(
    db,
    `insert into app.notifications (id,user_id,type,reason,subject_type,title,read_at,snoozed_until,archived_at,created_at)
    select id,user_id,'test.home',reason::app.notification_reason,subject_type,
      '{"en":"Home update","ru":"Обновление","uz-Latn":"Yangilik","uz-Cyrl":"Янгилик"}'::jsonb,
      case when is_read then now() else null end,
      case when snoozed then now() + interval '1 day' else null end,
      case when archived then now() else null end,
      '2026-10-23T12:34:56.123456Z'::timestamptz
    from jsonb_to_recordset($1::jsonb) as n(id uuid,user_id uuid,reason text,subject_type text,is_read boolean,snoozed boolean,archived boolean)`,
    [JSON.stringify(rows.map((row) => ({ ...row, is_read: 'read' in row ? row.read : false })))],
  )
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
type Feed = {
  items: { id: string }[]
  unreadCount: number
  groupCounts: { tasks: number; events: number; summaries: number; system: number }
  nextCursor: string | null
}
async function get(query: string) {
  const response = await fetch(`${server.baseUrl}/api/v1/notifications?${query}`, {
    headers: { cookie: session.cookie },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as Feed
}
describe('Home inbox totals and pagination', () => {
  it('returns full authorized group totals before the cursor and does not skip tied microsecond timestamps', async () => {
    let page = await get('status=inbox&limit=10')
    expect(page.items).toHaveLength(10)
    expect(page.groupCounts).toEqual({ tasks: 30, events: 1, summaries: 1, system: 1 })
    expect(page.unreadCount).toBe(32)
    const ids = page.items.map((item) => item.id)
    // Each page depends on the previous opaque cursor; all records share one microsecond timestamp.
    for (let index = 0; page.nextCursor && index < 5; index += 1) {
      page = await get(`status=inbox&limit=10&cursor=${encodeURIComponent(page.nextCursor)}`)
      ids.push(...page.items.map((item) => item.id))
      expect(page.groupCounts).toEqual({ tasks: 30, events: 1, summaries: 1, system: 1 })
    }
    expect(page.nextCursor).toBeNull()
    expect(ids).toHaveLength(33)
    expect(new Set(ids).size).toBe(33)
  })
  it('applies status and reason filters to totals without exposing another recipient or snoozed updates', async () => {
    expect((await get('status=unread')).groupCounts).toEqual({
      tasks: 29,
      events: 1,
      summaries: 1,
      system: 1,
    })
    expect((await get('status=archived')).groupCounts).toEqual({
      tasks: 0,
      events: 1,
      summaries: 0,
      system: 0,
    })
    expect((await get('status=inbox&reason=assigned')).groupCounts).toEqual({
      tasks: 30,
      events: 0,
      summaries: 0,
      system: 0,
    })
    expect((await get('status=inbox&cursor=2026-10-23T12%3A34%3A56.123Z')).groupCounts.tasks).toBe(
      30,
    )
    const invalid = await fetch(`${server.baseUrl}/api/v1/notifications?cursor=broken`, {
      headers: { cookie: session.cookie },
    })
    expect(invalid.status).toBe(422)
  })
})

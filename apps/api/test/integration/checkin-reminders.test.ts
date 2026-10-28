import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { processCheckins } from '../../src/modules/checkins/worker.js'
import {
  seedDepartment,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'
let db: Db, server: Server, departmentId: string
const at = (time: string) => new Date(`2026-11-02T${time}+05:00`)
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Check-in reminder QA', slug: 'reminders-' + randomUUID() })
  ).id
  await superuserQuery(
    db,
    "insert into app.telegram_groups(id,department_id,chat_id,kinds) values($1,$2,-991123,array['events'])",
    [randomUUID(), departmentId],
  )
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
describe('scheduled check-in reminders', () => {
  it('waits for 09:00 Tashkent, uses the connected group, resumes disabled transport and sends once', async () => {
    const send = vi.fn(async (_chat: string, _text: string) => ({
      ok: true as const,
      messageId: 91,
    }))
    await processCheckins(send, () => true, at('08:59:00'))
    expect(send).not.toHaveBeenCalled()
    await processCheckins(send, () => false, at('09:00:00'))
    expect(send).not.toHaveBeenCalled()
    await processCheckins(send, () => true, at('09:01:00'))
    await processCheckins(send, () => true, at('09:02:00'))
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0]).toBe('-991123')
    expect(send.mock.calls[0]?.[1]).toContain('/analytics?cycle=')
    expect(
      await superuserQuery(
        db,
        'select id from app.checkin_reminders where department_id=$1 and sent_at is not null',
        [departmentId],
      ),
    ).toHaveLength(1)
  })
  it('retries an expired failed lease, but skips disconnected groups and already locked checkout', async () => {
    const friday = new Date('2026-11-13T09:00:00+05:00')
    const fail = vi.fn(async () => ({ ok: false as const, error: 'temporary' }))
    await processCheckins(fail, () => true, friday)
    await processCheckins(fail, () => true, friday)
    expect(fail).toHaveBeenCalledOnce()
    await superuserQuery(
      db,
      "update app.checkin_reminders set lease_until=now()-interval '1 minute' where phase='checkout'",
    )
    await superuserQuery(
      db,
      'update app.telegram_groups set disconnected_at=now() where department_id=$1',
      [departmentId],
    )
    const send = vi.fn(async () => ({ ok: true as const, messageId: 92 }))
    await processCheckins(send, () => true, friday)
    expect(send).not.toHaveBeenCalled()
    await superuserQuery(
      db,
      'update app.telegram_groups set disconnected_at=null where department_id=$1',
      [departmentId],
    )
    await processCheckins(send, () => true, friday)
    expect(send).toHaveBeenCalledOnce()
    await superuserQuery(
      db,
      "update app.checkin_reminders set sent_at=null,lease_until=null where phase='checkout'",
    )
    await superuserQuery(
      db,
      'update app.checkin_cycles set checkout_locked_at=now() where department_id=$1',
      [departmentId],
    )
    await processCheckins(send, () => true, friday)
    expect(send).toHaveBeenCalledOnce()
  })
})

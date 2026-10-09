import { randomUUID } from 'node:crypto'
import { problemSchema } from '@devon/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { quietHoursSchema } from '../../src/modules/notifications/schemas.js'
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

let db: Db
let server: Server
let ownId: string
let foreignId: string
let userId: string
let session: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  ownId = (await seedDepartment(db, { name: 'Own quiet default QA', slug: randomUUID() })).id
  foreignId = (await seedDepartment(db, { name: 'Foreign quiet default QA', slug: randomUUID() }))
    .id
  const user = await seedMember(db, ownId, { role: 'member' })
  userId = user.id
  session = await loginAs(server.baseUrl, user.login)
  await superuserQuery(
    db,
    `insert into app.notification_department_settings
    (department_id,quiet_start_minute,quiet_end_minute,quiet_weekends,group_connect_head_only)
    values ($1,1200,480,true,true), ($2,1380,1381,false,true)`,
    [ownId, foreignId],
  )
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})

async function read(id: string) {
  return fetch(`${server.baseUrl}/api/v1/notifications/quiet-hours?departmentId=${id}`, {
    headers: { cookie: session.cookie },
  })
}
async function write(id: string, startMinute: number, endMinute: number) {
  return fetch(`${server.baseUrl}/api/v1/notifications/quiet-hours?departmentId=${id}`, {
    method: 'PUT',
    headers: session.headers,
    body: JSON.stringify({ startMinute, endMinute, includeWeekends: true }),
  })
}

describe('personal quiet-hours selected department boundary', () => {
  it('refuses a foreign selected department without disclosing its default', async () => {
    const response = await read(foreignId)
    const result = (await response.json()) as { effective?: { startMinute: number } }
    expect({ status: response.status, disclosedStart: result.effective?.startMinute }).toEqual({
      status: 403,
      disclosedStart: undefined,
    })
  })
  it('refuses a foreign selected department before persisting a less-quiet personal override', async () => {
    const response = await write(foreignId, 1320, 1380)
    const rows = await superuserQuery<{ start_minute: number; end_minute: number }>(
      db,
      'select start_minute,end_minute from app.notification_quiet_hours where user_id=$1',
      [userId],
    )
    expect({ status: response.status, persisted: rows }).toEqual({ status: 403, persisted: [] })
  })
  it('retains an active own department read and validated personal write', async () => {
    expect((await read(ownId)).status).toBe(200)
    const response = await write(ownId, 1140, 540)
    expect(response.status).toBe(200)
    expect(quietHoursSchema.parse(await response.json()).effective).toEqual({
      startMinute: 1140,
      endMinute: 540,
      includeWeekends: true,
      source: 'personal',
    })
  })
  it('returns a standard field validation Problem without replacing a valid personal override', async () => {
    const before = await superuserQuery(
      db,
      'select start_minute,end_minute from app.notification_quiet_hours where user_id=$1',
      [userId],
    )
    const response = await write(ownId, 1320, 360)
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    const refusal = problemSchema.parse(await response.json())
    expect({ code: refusal.code, errors: refusal.errors }).toEqual({
      code: 'validation_failed',
      errors: [{ path: 'quietHours', code: 'quiet_hours_too_loud' }],
    })
    expect(
      await superuserQuery(
        db,
        'select start_minute,end_minute from app.notification_quiet_hours where user_id=$1',
        [userId],
      ),
    ).toEqual(before)
  })
})

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  loginAs,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'

let db: Db
let server: Server
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

it('retires bulk writes and undo without affecting individual card editing', async () => {
  const department = await seedDepartment(db, {
    name: 'Individual card actions',
    slug: `individual-cards-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const session = await loginAs(server.baseUrl, head.login)
  const request = (path: string, method: string, data: unknown) =>
    fetch(`${server.baseUrl}/api/v1${path}`, {
      method,
      headers: session.headers,
      body: JSON.stringify(data),
    })
  const ids: string[] = []
  for (const title of ['First task', 'Second task']) {
    const created = await request('/cards', 'POST', { title, kind: 'task' })
    expect(created.status).toBe(201)
    ids.push(((await created.json()) as { id: string }).id)
  }
  const rows = () =>
    superuserQuery<{ id: string; priority: string; version: number }>(
      db,
      'select id,priority,version from app.cards where id=any($1::uuid[]) order by id',
      [ids],
    )
  const before = await rows()
  expect((await request('/cards/bulk', 'POST', { ids, patch: { priority: 'high' } })).status).toBe(
    404,
  )
  expect(
    (
      await request('/cards/bulk/undo', 'POST', {
        entries: ids.map((id) => ({ id, priority: 'low' })),
      })
    ).status,
  ).toBe(404)
  expect(await rows()).toEqual(before)

  const changed = await request(`/cards/${ids[0]}`, 'PATCH', { priority: 'high' })
  expect(changed.status).toBe(200)
  const after = await rows()
  expect(after.find((row) => row.id === ids[0])?.priority).toBe('high')
  expect(after.find((row) => row.id === ids[1])).toEqual(before.find((row) => row.id === ids[1]))
})

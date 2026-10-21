import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { CardRef } from '../../src/modules/work/schemas-plus.js'
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
let session: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Archived references',
    slug: `archive-${randomUUID()}`,
  })
  await superuserQuery(
    db,
    `update app.departments set features='{"focus_list":true,"dependencies":true}'::jsonb where id=$1`,
    [department.id],
  )
  const head = await seedMember(db, department.id, { role: 'head' })
  session = await loginAs(server.baseUrl, head.login)
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(path: string, method = 'GET', body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

it('preserves real completion timestamps in focus and dependency references after archiving', async () => {
  const [unfinished, completed] = await Promise.all(
    ['Unfinished', 'Completed'].map(async (title) => {
      const response = await request('/cards', 'POST', { title })
      expect(response.status).toBe(201)
      return (await response.json()) as { id: string }
    }),
  )
  const pinned = await Promise.all(
    [unfinished!, completed!].map((card) => request('/work/focus', 'POST', { cardId: card.id })),
  )
  expect(pinned.map((response) => response.status)).toEqual([204, 204])
  expect(
    (
      await request(`/cards/${unfinished!.id}/dependencies`, 'POST', {
        blockedByCardId: completed!.id,
      })
    ).status,
  ).toBe(201)
  expect((await request(`/cards/${completed!.id}`, 'PATCH', { status: 'done' })).status).toBe(200)
  const archived = await Promise.all(
    [unfinished!, completed!].map((card) =>
      request(`/cards/${card.id}`, 'PATCH', { status: 'archived' }),
    ),
  )
  expect(archived.map((response) => response.status)).toEqual([200, 200])

  const response = await request('/work/focus')
  expect(response.status).toBe(200)
  const focus = (await response.json()) as { items: { cardId: string; card: CardRef }[] }
  expect(focus.items.find((pin) => pin.cardId === unfinished!.id)?.card).toMatchObject({
    status: 'archived',
    doneAt: null,
  })
  const finished = focus.items.find((pin) => pin.cardId === completed!.id)!.card
  expect(finished.status).toBe('archived')
  expect(finished.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  const dependencies = await request(`/cards/${unfinished!.id}/dependencies`)
  expect(dependencies.status).toBe(200)
  expect(await dependencies.json()).toMatchObject({
    blockedBy: [{ card: { id: completed!.id, status: 'archived', doneAt: finished.doneAt } }],
  })
})

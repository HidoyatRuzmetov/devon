import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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

it('rejects retired archive mutations and preserves completion in pins and dependencies', async () => {
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
  expect(archived.map((response) => response.status)).toEqual([422, 422])

  const response = await request('/work/focus')
  expect(response.status).toBe(200)
  const focus = (await response.json()) as { items: { cardId: string; card: CardRef }[] }
  expect(focus.items.find((pin) => pin.cardId === unfinished!.id)?.card).toMatchObject({
    status: 'active',
    doneAt: null,
  })
  const finished = focus.items.find((pin) => pin.cardId === completed!.id)!.card
  expect(finished.status).toBe('done')
  expect(finished.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  const dependencies = await request(`/cards/${unfinished!.id}/dependencies`)
  expect(dependencies.status).toBe(200)
  expect(await dependencies.json()).toMatchObject({
    blockedBy: [{ card: { id: completed!.id, status: 'done', doneAt: finished.doneAt } }],
  })
})

it('preserves legacy archived tasks as Done and permits more than five personal pins', async () => {
  const ids: string[] = []
  for (let i = 0; i < 7; i++) {
    const created = await request('/cards', 'POST', { title: `Preserved pin ${i}` })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    ids.push(id)
    expect((await request('/work/focus', 'POST', { cardId: id })).status).toBe(204)
  }
  const pins = (await (await request('/work/focus')).json()) as {
    items: { cardId: string }[]
    max?: number
  }
  expect(pins.items.map((pin) => pin.cardId)).toEqual(expect.arrayContaining(ids))
  expect(pins.max).toBeUndefined()
  await superuserQuery(db, 'alter table app.cards drop constraint cards_supported_status')
  await superuserQuery(
    db,
    `update app.cards set status='archived',done_at=null,archived_at='2026-11-02T08:00:00Z' where id=$1`,
    [ids[0]],
  )
  await superuserQuery(
    db,
    readFileSync(
      new URL('../../../../packages/db/migrations/2029_retire_card_archive.sql', import.meta.url),
      'utf8',
    ),
  )
  const rows = await superuserQuery(
    db,
    'select status,done_at,deleted_at from app.cards where id=$1',
    [ids[0]],
  )
  expect(rows[0]).toMatchObject({ status: 'done', deleted_at: null })
  expect(new Date(rows[0]!['done_at'] as string).toISOString()).toBe('2026-11-02T08:00:00.000Z')
  await expect(
    superuserQuery(db, "update app.cards set status='archived' where id=$1", [ids[0]]),
  ).rejects.toThrow()
})

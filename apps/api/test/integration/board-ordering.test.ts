import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BoardDTO, CardDTO } from '../../src/modules/work/schemas.js'
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
let head: Session
let member: Session
let other: Session
let departmentId: string
let headId: string
let memberId: string
let thirdId: string
let foreignId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Board ordering',
    slug: `board-${randomUUID()}`,
  })
  const foreign = await seedDepartment(db, { name: 'Other', slug: `other-${randomUUID()}` })
  departmentId = department.id
  await superuserQuery(
    db,
    'update app.departments set features = \'{"focus_list":true}\'::jsonb where id = $1',
    [departmentId],
  )
  const users = await Promise.all([
    seedMember(db, department.id, { role: 'head' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, foreign.id, { role: 'head' }),
  ])
  ;[headId, memberId, thirdId, foreignId] = users.map((user) => user.id) as [
    string,
    string,
    string,
    string,
  ]
  ;[head, member, other] = (await Promise.all(
    [users[0], users[1], users[3]].map((user) => loginAs(server.baseUrl, user!.login)),
  )) as [Session, Session, Session]
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(path: string, method = 'GET', body?: unknown, session = head) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function card(assignee = headId, dueAt: string | null = null): Promise<CardDTO> {
  const res = await request('/cards', 'POST', {
    title: `Ordering ${randomUUID()}`,
    assigneeUserId: assignee,
    dueAt,
  })
  expect(res.status).toBe(201)
  return res.json() as Promise<CardDTO>
}
async function board(session = head) {
  return (await (await request('/board', 'GET', undefined, session)).json()) as BoardDTO
}
function ids(board: BoardDTO, userId: string) {
  return board.columns.find((col) => col.member.userId === userId)!.cards.map((card) => card.id)
}
async function move(
  id: string,
  toUserId: string | null,
  targetCardId: string | null,
  edge = 'before',
  session = head,
) {
  return request(`/cards/${id}/move`, 'POST', { toUserId, targetCardId, edge }, session)
}

describe('authoritative board ordering and personal focus', () => {
  it('serializes moved card text as JSON, including HTML-like titles', async () => {
    const title = '<img src=x onerror=alert(1)>'
    const created = await request('/cards', 'POST', { title, assigneeUserId: headId })
    expect(created.status).toBe(201)
    const item = (await created.json()) as CardDTO
    const response = await move(item.id, headId, null)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(((await response.json()) as CardDTO).title).toBe(title)
  })

  it('appends unique ranks and preserves a manual move across due dates and an unrelated column', async () => {
    const first = await card(headId, '2030-01-01T00:00:00Z')
    const second = await card(headId, '2027-01-01T00:00:00Z')
    const third = await card(headId)
    const untouched = [await card(thirdId), await card(thirdId)]
    expect(new Set([first.orderKey, second.orderKey, third.orderKey]).size).toBe(3)
    expect(
      ids(await board(), headId).filter((id) => [first.id, second.id, third.id].includes(id)),
    ).toEqual([first.id, second.id, third.id])
    expect((await move(third.id, headId, first.id)).status).toBe(200)
    expect(
      ids(await board(), headId).filter((id) => [first.id, second.id, third.id].includes(id)),
    ).toEqual([third.id, first.id, second.id])
    const snapshot = (await board()).columns.find((col) => col.member.userId === thirdId)!.cards
    expect(snapshot.map((item) => item.id)).toEqual(untouched.map((item) => item.id))
    expect(snapshot.map((item) => item.orderKey)).toEqual(untouched.map((item) => item.orderKey))
    const events = await superuserQuery<{ type: string }>(
      db,
      "select type from app.outbox_events where payload->>'cardId' = $1",
      [third.id],
    )
    expect(events.some((event) => event.type === 'work.card.reordered')).toBe(true)
  })

  it('repairs tied legacy ranks only in the destination and persists sequential and concurrent moves', async () => {
    const tied = [await card(memberId), await card(memberId), await card(memberId)]
    await superuserQuery(db, "update app.cards set order_key = 'a0' where id = any($1::uuid[])", [
      tied.map((item) => item.id),
    ])
    const before = ids(await board(), memberId)
    const target = before.at(-1)!
    const moving = before[0]!
    expect((await move(moving, memberId, target)).status).toBe(200)
    const after = ids(await board(), memberId)
    const targetIndex = after.indexOf(target)
    expect(after[targetIndex - 1]).toBe(moving)
    const fresh = (await board()).columns.find((col) => col.member.userId === memberId)!.cards
    expect(new Set(fresh.map((item) => item.orderKey)).size).toBe(fresh.length)
    const incoming = [await card(headId), await card(headId)]
    const results = await Promise.all(incoming.map((item) => move(item.id, memberId, target)))
    expect(results.map((res) => res.status)).toEqual([200, 200])
    const final = (await board()).columns.find((col) => col.member.userId === memberId)!.cards
    expect(new Set(final.map((item) => item.orderKey)).size).toBe(final.length)
    expect(
      final.map((item) => item.id).filter((id) => incoming.some((item) => item.id === id)),
    ).toHaveLength(2)
    expect((await move(incoming[0]!.id, headId, null, 'after')).status).toBe(200)
    expect(ids(await board(), headId).at(-1)).toBe(incoming[0]!.id)
  })

  it('rejects foreign/stale targets, foreign assignees and moves of a colleague-owned card', async () => {
    const item = await card(thirdId)
    const wrongColumn = await card(memberId)
    expect((await move(item.id, thirdId, wrongColumn.id)).status).toBe(409)
    expect((await move(item.id, foreignId, null)).status).toBe(422)
    expect((await move(item.id, memberId, null, 'after', member)).status).toBe(403)
    expect((await move(item.id, foreignId, null, 'after', other)).status).toBe(404)
    expect(
      (await request(`/cards/${item.id}`, 'PATCH', { assigneeUserId: foreignId })).status,
    ).toBe(422)
    expect((await request(`/cards/${item.id}`, 'PATCH', { giverUserId: foreignId })).status).toBe(
      422,
    )
    expect((await request(`/cards/${item.id}`, 'PATCH', { orderKey: 'invalid key' })).status).toBe(
      422,
    )
  })

  it('raises the newest focus pin immediately in its viewer board/list and leaves colleague ranks untouched', async () => {
    const items = [await card(headId), await card(headId), await card(headId)]
    expect((await request('/work/focus', 'POST', { cardId: items[1]!.id })).status).toBe(204)
    expect((await request('/work/focus', 'POST', { cardId: items[2]!.id })).status).toBe(204)
    const focus = (await (await request('/work/focus')).json()) as { items: { cardId: string }[] }
    expect(focus.items.map((pin) => pin.cardId)).toEqual([items[2]!.id, items[1]!.id])
    expect(ids(await board(), headId).slice(0, 2)).toEqual([items[2]!.id, items[1]!.id])
    const colleagueBoard = await board(member)
    const same = colleagueBoard.columns
      .find((col) => col.member.userId === headId)!
      .cards.filter((item) => items.some((original) => original.id === item.id))
    expect(same.map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(same.every((item) => !item.focusPinned)).toBe(true)
    expect(same.map((item) => item.orderKey)).toEqual(items.map((item) => item.orderKey))
    expect(
      (await request('/work/focus/reorder', 'POST', { cardIds: [items[1]!.id, items[2]!.id] }))
        .status,
    ).toBe(204)
    expect(ids(await board(), headId).slice(0, 2)).toEqual([items[1]!.id, items[2]!.id])
    expect(
      (await request('/work/focus/reorder', 'POST', { cardIds: [items[1]!.id, items[1]!.id] }))
        .status,
    ).toBe(409)
    expect((await request(`/work/focus/${items[1]!.id}`, 'DELETE')).status).toBe(204)
    expect((await request(`/work/focus/${items[2]!.id}`, 'DELETE')).status).toBe(204)
    expect(ids(await board(), headId).filter((id) => items.some((item) => item.id === id))).toEqual(
      items.map((item) => item.id),
    )
  })

  it('keeps the five-pin cap under concurrent adds and frees invisible deleted slots', async () => {
    const items = await Promise.all(Array.from({ length: 8 }, () => card(memberId)))
    const results = await Promise.all(
      items.map((item) => request('/work/focus', 'POST', { cardId: item.id }, member)),
    )
    expect(results.filter((res) => res.status === 204)).toHaveLength(5)
    expect(results.filter((res) => res.status === 422)).toHaveLength(3)
    const focus = (await (await request('/work/focus', 'GET', undefined, member)).json()) as {
      items: { cardId: string }[]
    }
    expect(focus.items).toHaveLength(5)
    const deleted = focus.items[0]!.cardId
    expect((await request(`/cards/${deleted}`, 'DELETE')).status).toBe(204)
    const replacement = items.find((item) => !focus.items.some((pin) => pin.cardId === item.id))!
    expect((await request('/work/focus', 'POST', { cardId: replacement.id }, member)).status).toBe(
      204,
    )
    const after = (await (await request('/work/focus', 'GET', undefined, member)).json()) as {
      items: { cardId: string }[]
    }
    expect(after.items).toHaveLength(5)
    expect(after.items[0]!.cardId).toBe(replacement.id)
  })
  it('keeps a removed/deleted assignee’s open cards visible for review and supports dropping beside/reassigning them', async () => {
    const departed = await seedMember(db, departmentId, { role: 'member' })
    const deletedUser = await seedMember(db, departmentId, { role: 'member' })
    const orphan = await card(departed.id)
    const deletedOrphan = await card(deletedUser.id)
    expect(
      (await request(`/departments/${departmentId}/members/${departed.id}/remove`, 'POST')).status,
    ).toBe(204)
    await superuserQuery(
      db,
      "update app.users set status = 'deleted', deleted_at = now() where id = $1",
      [deletedUser.id],
    )
    const review = await board()
    expect((await board(member)).unassigned.find((row) => row.id === orphan.id)!.canEdit).toBe(
      false,
    )
    expect(
      review.members.some((item) => item.userId === departed.id || item.userId === deletedUser.id),
    ).toBe(false)
    for (const [item, originalId] of [
      [orphan, departed.id],
      [deletedOrphan, deletedUser.id],
    ] as const) {
      const retained = review.unassigned.find((row) => row.id === item.id)!
      expect(retained.assigneeUserId).toBe(originalId)
      expect(retained.assigneeUnavailable).toBe(true)
      expect(retained.canEdit).toBe(true)
    }
    const incoming = await card(headId)
    expect((await move(incoming.id, null, orphan.id)).status).toBe(200)
    const unassignedIds = (await board()).unassigned.map((item) => item.id)
    expect(unassignedIds[unassignedIds.indexOf(orphan.id) - 1]).toBe(incoming.id)
    expect(((await (await request(`/cards/${orphan.id}`)).json()) as CardDTO).assigneeUserId).toBe(
      departed.id,
    )
    expect((await move(orphan.id, memberId, null, 'after')).status).toBe(200)
    expect((await board()).unassigned.some((item) => item.id === orphan.id)).toBe(false)
    expect(ids(await board(), memberId).at(-1)).toBe(orphan.id)
    const activity = await superuserQuery<{ data: { from: string; to: string } }>(
      db,
      "select data from app.card_activity where card_id = $1 and kind = 'assigned'",
      [orphan.id],
    )
    expect(activity[0]!.data).toEqual({ from: departed.id, to: memberId })
  })
})

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

let db: Db, server: Server
let head: Session, member: Session, colleague: Session, foreign: Session
let departmentId: string, memberId: string, colleagueId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Checklist discussion',
    slug: `discussion-${randomUUID()}`,
  })
  const other = await seedDepartment(db, {
    name: 'Other',
    slug: `other-${randomUUID()}`,
  })
  departmentId = department.id
  const users = await Promise.all([
    seedMember(db, departmentId, { role: 'head' }),
    seedMember(db, departmentId, { role: 'member' }),
    seedMember(db, departmentId, { role: 'member' }),
    seedMember(db, other.id, { role: 'member' }),
  ])
  memberId = users[1]!.id
  colleagueId = users[2]!.id
  ;[head, member, colleague, foreign] = (await Promise.all(
    users.map((user) => loginAs(server.baseUrl, user.login)),
  )) as [Session, Session, Session, Session]
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function request(session: Session, path: string, method = 'GET', body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function task(assigneeUserId = memberId) {
  const result = await request(head, '/cards', 'POST', {
    title: `Task ${randomUUID()}`,
    assigneeUserId,
  })
  expect(result.status).toBe(201)
  const card = (await result.json()) as { id: string }
  const created = await request(head, `/cards/${card.id}/checklist`, 'POST', {
    text: 'Publish evidence',
  })
  expect(created.status).toBe(201)
  const item = (await created.json()) as { id: string }
  return {
    cardId: card.id,
    itemId: item.id,
    thread: `/cards/${card.id}/checklist/${item.id}/comments`,
  }
}
async function openCycle() {
  const response = await request(member, '/checkins/')
  expect(response.status).toBe(200)
  const board = (await response.json()) as { currentCycleId: string }
  await superuserQuery(
    db,
    `update app.checkin_cycles set checkin_locked_at=null,checkout_locked_at=null,
    checkin_deadline=now()+interval '3 days',checkout_deadline=now()+interval '7 days' where id=$1`,
    [board.currentCycleId],
  )
  await superuserQuery(db, 'delete from app.checkin_member_locks where cycle_id=$1', [
    board.currentCycleId,
  ])
  return board.currentCycleId
}

describe('one checklist discussion across task, project and check-in', () => {
  it('keeps item threads separate, exposes the same counts and enforces author/head revisions', async () => {
    const first = await task(),
      second = await task()
    const result = await request(member, first.thread, 'POST', {
      text: 'The source is ready',
    })
    expect(result.status).toBe(201)
    const comment = (await result.json()) as { id: string }
    const own = await (await request(member, first.thread)).json()
    expect(own).toEqual([
      expect.objectContaining({
        id: comment.id,
        checklistItemId: first.itemId,
        canEdit: true,
        canDelete: true,
      }),
    ])
    expect(await (await request(colleague, first.thread)).json()).toEqual([
      expect.objectContaining({ canEdit: false, canDelete: false }),
    ])
    const detail = (await (await request(member, `/cards/${first.cardId}`)).json()) as {
      comments: unknown[]
      checklist: { commentCount: number }[]
    }
    expect(detail.comments).toEqual([])
    expect(detail.checklist[0]?.commentCount).toBe(1)
    const batch = await (
      await request(member, `/cards/checklists?cardIds=${first.cardId},${second.cardId}`)
    ).json()
    expect(batch).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.itemId, commentCount: 1 })]),
    )
    expect(
      (
        await request(colleague, `${first.thread}/${comment.id}`, 'PATCH', {
          text: 'Not mine',
          editedAt: null,
        })
      ).status,
    ).toBe(403)
    expect(
      (await request(member, `/cards/${first.cardId}/comments/${comment.id}`, 'DELETE')).status,
    ).toBe(404)
    expect((await request(member, `${second.thread}/${comment.id}`, 'DELETE')).status).toBe(404)
    expect((await request(foreign, first.thread)).status).toBe(404)
    expect(
      (
        await request(member, `${first.thread}/${comment.id}`, 'PATCH', {
          text: 'Corrected source',
          editedAt: null,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await request(member, `${first.thread}/${comment.id}`, 'PATCH', {
          text: 'Stale change',
          editedAt: null,
        })
      ).status,
    ).toBe(409)
    expect((await request(head, `${first.thread}/${comment.id}`, 'DELETE')).status).toBe(204)
    expect(await (await request(member, first.thread)).json()).toEqual([])
  })

  it('allows discussion under an agreed item while retaining its text/delete protections and state synchronisation', async () => {
    const current = await task(),
      cycleId = await openCycle()
    expect(
      (
        await request(member, `/checkins/cycles/${cycleId}/entries`, 'POST', {
          checklistItemId: current.itemId,
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await request(head, `/checkins/cycles/${cycleId}/lock`, 'POST', {
          phase: 'checkin',
          memberUserId: memberId,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await request(member, current.thread, 'POST', {
          text: 'Evidence for the agreed deliverable',
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await request(member, `/cards/${current.cardId}/checklist/${current.itemId}`, 'PATCH', {
          text: 'Change agreement',
        })
      ).status,
    ).toBe(409)
    expect(
      (await request(member, `/cards/${current.cardId}/checklist/${current.itemId}`, 'DELETE'))
        .status,
    ).toBe(409)
    expect(
      (
        await request(member, `/cards/${current.cardId}/checklist/${current.itemId}`, 'PATCH', {
          done: true,
        })
      ).status,
    ).toBe(204)
    const board = (await (await request(member, `/checkins/?cycleId=${cycleId}`)).json()) as {
      entries: {
        checklistItemId: string
        commentCount: number
        state: string
      }[]
    }
    expect(board.entries.find((item) => item.checklistItemId === current.itemId)).toMatchObject({
      state: 'done',
      commentCount: 1,
    })
    await superuserQuery(
      db,
      'update app.checkin_member_locks set checkout_locked_at=now() where cycle_id=$1 and member_user_id=$2',
      [cycleId, memberId],
    )
    expect(
      (
        await request(member, current.thread, 'POST', {
          text: 'Additional context, not an agreement change',
        })
      ).status,
    ).toBe(201)
  })

  it('omits completed unselected checklist items and rejects attempts to add them through either selection route', async () => {
    const current = await task(),
      cycleId = await openCycle()
    expect(
      (
        await request(member, `/cards/${current.cardId}/checklist/${current.itemId}`, 'PATCH', {
          done: true,
        })
      ).status,
    ).toBe(204)
    const path = `/checkins/cycles/${cycleId}/members/${memberId}`
    const candidates = (await (await request(member, `${path}/candidates`)).json()) as {
      id: string
      checklist: { id: string }[]
    }[]
    expect(candidates.find((card) => card.id === current.cardId)?.checklist).toEqual([])
    expect(
      (
        await request(member, `${path}/selection`, 'PUT', {
          addItemIds: [current.itemId],
          removeEntryIds: [],
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(member, `/checkins/cycles/${cycleId}/entries`, 'POST', {
          checklistItemId: current.itemId,
        })
      ).status,
    ).toBe(422)
  })

  it('allows members to create their own checked-in task, but never someone else’s', async () => {
    const cycleId = await openCycle()
    const body = {
      operationId: randomUUID(),
      title: 'My agreed task',
      checklist: ['My deliverable'],
    }
    expect(
      (await request(member, `/checkins/cycles/${cycleId}/members/${memberId}/tasks`, 'POST', body))
        .status,
    ).toBe(201)
    expect(
      (
        await request(member, `/checkins/cycles/${cycleId}/members/${colleagueId}/tasks`, 'POST', {
          ...body,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(member, '/cards', 'POST', {
          title: 'Someone else',
          assigneeUserId: colleagueId,
        })
      ).status,
    ).toBe(403)
    const own = await request(member, '/cards', 'POST', {
      title: 'Own default task',
    })
    expect(own.status).toBe(201)
    expect(await own.json()).toMatchObject({ assigneeUserId: memberId })
  })
})

describe('shared assigned-task pins and deleted history', () => {
  it('lets the head maintain another person’s assigned-task pins while preserving private other-card pins', async () => {
    const assigned = await task(),
      elsewhere = await task(colleagueId)
    const revision = async () =>
      Number(
        (
          await superuserQuery(
            db,
            'select revision from app.ai_context_revisions where department_id=$1',
            [departmentId],
          )
        )[0]!['revision'],
      )
    const beforePin = await revision()
    expect(
      (
        await request(head, '/work/focus', 'POST', {
          cardId: assigned.cardId,
          userId: memberId,
        })
      ).status,
    ).toBe(204)
    expect(await revision()).toBeGreaterThan(beforePin)
    expect(
      (
        await request(member, '/work/focus', 'POST', {
          cardId: elsewhere.cardId,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await request(head, '/work/focus', 'POST', {
          cardId: elsewhere.cardId,
          userId: memberId,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(colleague, '/work/focus', 'POST', {
          cardId: assigned.cardId,
          userId: memberId,
        })
      ).status,
    ).toBe(403)
    const publicPins = (await (
      await request(colleague, `/work/focus?userId=${memberId}`)
    ).json()) as { items: { cardId: string }[] }
    expect(publicPins.items.some((item) => item.cardId === assigned.cardId)).toBe(true)
    expect(publicPins.items.some((item) => item.cardId === elsewhere.cardId)).toBe(false)
    const card = await (await request(colleague, `/cards/${assigned.cardId}`)).json()
    expect(card).toMatchObject({ focusPinned: false, assigneePinned: true })
    expect(
      (await request(colleague, `/work/focus/${assigned.cardId}?userId=${memberId}`, 'DELETE'))
        .status,
    ).toBe(403)
    const beforeReorder = await revision()
    expect(
      (
        await request(head, '/work/focus/reorder', 'POST', {
          cardIds: [assigned.cardId],
          userId: memberId,
        })
      ).status,
    ).toBe(204)
    expect(await revision()).toBeGreaterThan(beforeReorder)
    const beforeUnpin = await revision()
    expect(
      (await request(head, `/work/focus/${assigned.cardId}?userId=${memberId}`, 'DELETE')).status,
    ).toBe(204)
    expect(await revision()).toBeGreaterThan(beforeUnpin)
    expect(await (await request(member, `/cards/${assigned.cardId}`)).json()).toMatchObject({
      assigneePinned: false,
    })
  })

  it('restores an old deleted task with all checklist data and rejects nonowners', async () => {
    const current = await task()
    expect((await request(member, '/work/focus', 'POST', { cardId: current.cardId })).status).toBe(
      204,
    )
    expect((await request(member, `/cards/${current.cardId}`, 'DELETE')).status).toBe(204)
    const replacement = await task()
    expect(
      (
        await request(member, '/work/focus', 'POST', {
          cardId: replacement.cardId,
        })
      ).status,
    ).toBe(204)
    await superuserQuery(
      db,
      "update app.cards set deleted_at=now()-interval '2 days' where id=$1",
      [current.cardId],
    )
    expect((await request(member, `/cards/${current.cardId}/undo-delete`, 'POST')).status).toBe(404)
    expect((await request(colleague, `/cards/${current.cardId}/restore`, 'POST')).status).toBe(403)
    expect((await request(foreign, `/cards/${current.cardId}/restore`, 'POST')).status).toBe(404)
    const deleted = (await (
      await request(member, `/cards?assigneeUserId=${memberId}&deleted=true`)
    ).json()) as { items: { id: string }[] }
    expect(deleted.items.some((card) => card.id === current.cardId)).toBe(true)
    expect((await request(member, `/cards/${current.cardId}/restore`, 'POST')).status).toBe(204)
    expect((await request(member, `/cards/${current.cardId}/restore`, 'POST')).status).toBe(204)
    const restored = await (await request(member, `/cards/${current.cardId}`)).json()
    expect(restored).toMatchObject({
      deletedAt: null,
      assigneePinned: true,
      checklist: [expect.objectContaining({ id: current.itemId })],
    })
  })

  it('paginates a person’s history independently of other assignees', async () => {
    await superuserQuery(
      db,
      `insert into app.cards(department_id,title,created_by_user_id,assignee_user_id)
      select $1,'History '||n,$2,$2 from generate_series(1,7) n`,
      [departmentId, colleagueId],
    )
    const first = (await (
      await request(member, `/cards?assigneeUserId=${colleagueId}&limit=2`)
    ).json()) as {
      items: { id: string; assigneeUserId: string }[]
      nextCursor: string
    }
    expect(first.items).toHaveLength(2)
    expect(first.items.every((item) => item.assigneeUserId === colleagueId)).toBe(true)
    expect(first.nextCursor).toBe('2')
    const second = (await (
      await request(
        member,
        `/cards?assigneeUserId=${colleagueId}&limit=2&cursor=${first.nextCursor}`,
      )
    ).json()) as { items: { id: string }[] }
    expect(second.items.some((item) => first.items.some((before) => before.id === item.id))).toBe(
      false,
    )
  })
})

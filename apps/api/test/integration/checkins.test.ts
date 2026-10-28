import type { CheckinBoard } from '@devon/contracts'
import { withContext, type RequestContext } from '@devon/db'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cycleDates } from '../../src/modules/checkins/calendar.js'
import { maintainCycles } from '../../src/modules/checkins/repo.js'
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
const actors: Awaited<ReturnType<typeof createActors>>[] = []
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
beforeEach(async () => {
  await superuserQuery(
    db,
    'delete from app.checkin_reminders; delete from app.checkin_entries; delete from app.checkin_cycles',
  )
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
async function createActors() {
  const department = await seedDepartment(db, {
    name: 'Check-in integrity',
    slug: `checkin-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' }),
    member = await seedMember(db, department.id, { role: 'member' })
  const headSession = await loginAs(server.baseUrl, head.login),
    session = await loginAs(server.baseUrl, member.login)
  return { department, head, member, headSession, session }
}
async function fixture(other = false) {
  const index = other ? 1 : 0
  actors[index] ??= await createActors()
  const { department, head, member, headSession, session } = actors[index]!
  const cardId = randomUUID(),
    itemId = randomUUID()
  await superuserQuery(
    db,
    "insert into app.cards(id,department_id,title,created_by_user_id,assignee_user_id) values($1,$2,'Delivery',$3,$3)",
    [cardId, department.id, member.id],
  )
  await superuserQuery(
    db,
    "insert into app.card_checklist_items(id,department_id,card_id,text) values($1,$2,$3,'Publish the report')",
    [itemId, department.id, cardId],
  )
  const response = await request(session, '/checkins/')
  expect(response.status).toBe(200)
  const board = (await response.json()) as CheckinBoard
  return {
    department,
    head,
    member,
    headSession,
    session,
    cardId,
    itemId,
    cycleId: board.currentCycleId,
    board,
  }
}
async function add(f: Awaited<ReturnType<typeof fixture>>, itemId = f.itemId) {
  const response = await request(f.session, `/checkins/cycles/${f.cycleId}/entries`, 'POST', {
    checklistItemId: itemId,
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}
async function read(f: Awaited<ReturnType<typeof fixture>>, cycleId = f.cycleId) {
  const response = await request(f.session, `/checkins/?cycleId=${cycleId}`)
  expect(response.status).toBe(200)
  return response.json() as Promise<CheckinBoard>
}
describe('check-in lifecycle and source integrity', () => {
  it('excludes the head, removes only the check-in link, and does not duplicate an item', async () => {
    const f = await fixture()
    expect(f.board.members.map((m) => m.userId)).toEqual([f.member.id])
    const id = await add(f)
    expect(await add(f)).toBe(id)
    expect((await read(f)).entries).toHaveLength(1)
    expect((await request(f.session, `/checkins/entries/${id}`, 'DELETE')).status).toBe(204)
    expect((await read(f)).entries).toHaveLength(0)
    expect(
      (
        await superuserQuery<{ deleted_at: null }>(
          db,
          'select deleted_at from app.card_checklist_items where id=$1',
          [f.itemId],
        )
      )[0]?.deleted_at,
    ).toBeNull()
  })
  it('only the head locks; late additions count, while agreed items cannot be removed', async () => {
    const f = await fixture(),
      id = await add(f)
    expect(
      (await request(f.session, `/checkins/cycles/${f.cycleId}/lock`, 'POST', { phase: 'checkin' }))
        .status,
    ).toBe(403)
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkin',
        })
      ).status,
    ).toBe(204)
    expect((await request(f.session, `/checkins/entries/${id}`, 'DELETE')).status).toBe(409)
    const extra = randomUUID()
    await superuserQuery(
      db,
      "insert into app.card_checklist_items(id,department_id,card_id,text) values($1,$2,$3,'Later delivery')",
      [extra, f.department.id, f.cardId],
    )
    await add(f, extra)
    expect((await read(f)).progress.find((p) => p.cycleId === f.cycleId)).toMatchObject({
      done: 0,
      total: 2,
    })
  })
  it('edits the actual checklist, counts blocked as unfinished, and rejects stale edits', async () => {
    const f = await fixture(),
      id = await add(f)
    const entry = (await read(f)).entries[0]!
    expect(
      (
        await request(f.session, `/checkins/entries/${id}`, 'PATCH', {
          version: entry.version,
          text: 'Send approved report',
          state: 'blocked',
        })
      ).status,
    ).toBe(204)
    const updated = (await read(f)).entries[0]!
    expect(updated).toMatchObject({ text: 'Send approved report', state: 'blocked' })
    expect((await read(f)).progress[0]).toMatchObject({ done: 0, total: 1 })
    expect(
      (
        await superuserQuery<{ text: string }>(
          db,
          'select text from app.card_checklist_items where id=$1',
          [f.itemId],
        )
      )[0]?.text,
    ).toBe('Send approved report')
    expect(
      (
        await request(f.session, `/checkins/entries/${id}`, 'PATCH', {
          version: entry.version,
          state: 'done',
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(f.session, `/checkins/entries/${id}`, 'PATCH', {
          version: updated.version,
          state: 'done',
        })
      ).status,
    ).toBe(204)
    expect((await read(f)).progress[0]).toMatchObject({ done: 1, total: 1 })
  })
  it('source edits update an open cycle, but a closed checkout stays frozen after edits and deletion', async () => {
    const f = await fixture(),
      id = await add(f)
    expect(
      (
        await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'PATCH', {
          text: 'Live revised result',
          done: true,
        })
      ).status,
    ).toBe(204)
    expect((await read(f)).entries[0]).toMatchObject({ text: 'Live revised result', state: 'done' })
    await superuserQuery(
      db,
      'update app.checkin_cycles set checkin_locked_at=now(),checkout_locked_at=now() where id=$1',
      [f.cycleId],
    )
    const frozen = (await read(f)).entries[0]!
    expect(
      (
        await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'PATCH', {
          text: 'Changed after checkout',
          done: false,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await request(f.session, `/checkins/entries/${id}`, 'PATCH', {
          version: frozen.version,
          state: 'pending',
        })
      ).status,
    ).toBe(409)
    expect((await request(f.session, `/checkins/entries/${id}`, 'DELETE')).status).toBe(409)
    expect(
      (await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'DELETE')).status,
    ).toBe(204)
    expect((await read(f)).entries[0]).toMatchObject({
      text: 'Live revised result',
      state: 'done',
      sourceAvailable: false,
      version: frozen.version,
    })
  })
  it('the deadline protects history even before the scheduler has run', async () => {
    const f = await fixture()
    await add(f)
    await superuserQuery(
      db,
      "update app.checkin_cycles set checkin_deadline=now()-interval '2 days',checkout_deadline=now()-interval '1 second' where id=$1",
      [f.cycleId],
    )
    expect(
      (
        await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'PATCH', {
          done: true,
        })
      ).status,
    ).toBe(204)
    const board = await read(f)
    expect(board.cycles.find((c) => c.id === f.cycleId)?.checkoutLockedAt).toBeTruthy()
    expect(board.entries[0]?.state).toBe('pending')
  })
  it('carries unfinished items once, keeps a declined carryover removed, and isolates closed periods', async () => {
    const f = await fixture()
    await add(f)
    const ctx: RequestContext = {
      requestId: randomUUID(),
      userId: null,
      actorRole: 'super_admin',
      departmentRole: 'head',
      departmentId: f.department.id,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'test',
    }
    const dates = cycleDates(f.board.cycles[0]!.startsOn)
    const future = new Date(dates.checkoutDeadline.getTime() + 1000)
    const next = await withContext(ctx, (tx) => maintainCycles(tx, ctx, future))
    expect(next).not.toBe(f.cycleId)
    let carried = await superuserQuery<{ id: string }>(
      db,
      'select id from app.checkin_entries where cycle_id=$1 and removed_at is null',
      [next],
    )
    expect(carried).toHaveLength(1)
    await superuserQuery(db, 'update app.checkin_entries set removed_at=now() where id=$1', [
      carried[0]!.id,
    ])
    await withContext(ctx, (tx) => maintainCycles(tx, ctx, future))
    carried = await superuserQuery<{ id: string }>(
      db,
      'select id from app.checkin_entries where cycle_id=$1 and removed_at is null',
      [next],
    )
    expect(carried).toHaveLength(0)
  })
  it('never reads or modifies another department’s cycle or checklist', async () => {
    const a = await fixture(),
      b = await fixture(true),
      id = await add(b)
    expect((await request(a.session, `/checkins/?cycleId=${b.cycleId}`)).status).toBe(404)
    expect(
      (
        await request(a.session, `/checkins/cycles/${a.cycleId}/entries`, 'POST', {
          checklistItemId: b.itemId,
        })
      ).status,
    ).toBe(404)
    expect((await request(a.session, `/checkins/entries/${id}`, 'DELETE')).status).toBe(404)
    expect(
      (
        await request(a.headSession, `/checkins/cycles/${b.cycleId}/lock`, 'POST', {
          phase: 'checkin',
        })
      ).status,
    ).toBe(404)
  })
})

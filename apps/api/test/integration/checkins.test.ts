import type { CheckinBoard } from '@devon/contracts'
import { applyMigrations, withContext, type RequestContext } from '@devon/db'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
  // Keep ordinary edit cases independent of the weekday on which CI runs.
  await superuserQuery(
    db,
    "update app.checkin_cycles set checkin_locked_at=null,checkin_deadline=now()+interval '1 day' where id=$1",
    [board.currentCycleId],
  )

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
  it('excludes completed and deleted tasks from selection without removing saved history', async () => {
    const f = await fixture()
    const entryId = await add(f)
    const deleted = await fixture()
    expect((await request(f.session, `/cards/${deleted.cardId}`, 'DELETE')).status).toBe(204)
    expect(
      (await request(f.session, `/cards/${f.cardId}`, 'PATCH', { status: 'done' })).status,
    ).toBe(200)
    const base = `/checkins/cycles/${f.cycleId}/members/${f.member.id}`
    const response = await request(f.session, `${base}/candidates`)
    expect(response.status).toBe(200)
    const ids = ((await response.json()) as { id: string }[]).map((card) => card.id)
    expect(ids).not.toContain(f.cardId)
    expect(ids).not.toContain(deleted.cardId)
    expect(
      (
        await request(f.session, `${base}/selection`, 'PUT', {
          addItemIds: [f.itemId],
          removeEntryIds: [],
        })
      ).status,
    ).toBe(409)
    expect((await read(f)).entries.some((entry) => entry.id === entryId)).toBe(true)
  })
  it('creates an individual task and selected checklist atomically for the head, including agreed check-ins', async () => {
    const f = await fixture()
    const path = `/checkins/cycles/${f.cycleId}/members/${f.member.id}/tasks`
    const input = {
      operationId: randomUUID(),
      title: 'Direct check-in task',
      priority: 'urgent',
      checklist: ['First delivery', 'Second delivery'],
    }
    expect((await request(f.session, path, 'POST', input)).status).toBe(403)
    const noCsrf = { ...f.headSession, headers: { ...f.headSession.headers } }
    delete noCsrf.headers['x-csrf-token']
    expect((await request(noCsrf, path, 'POST', input)).status).toBe(403)
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkin',
          memberUserId: f.member.id,
        })
      ).status,
    ).toBe(204)
    const response = await request(f.headSession, path, 'POST', input)
    expect(response.status, await response.clone().text()).toBe(201)
    const created = (await response.json()) as { id: string; checklistAdded: number }
    expect(created.checklistAdded).toBe(2)
    expect(await (await request(f.headSession, path, 'POST', input)).json()).toEqual(created)
    expect((await read(f)).entries.filter((e) => e.cardId === created.id)).toHaveLength(2)
    const card = (await (await request(f.headSession, `/cards/${created.id}`)).json()) as {
      card: { kind: string; projectId: string | null; assigneeUserId: string; priority: string }
    }
    expect(card).toMatchObject({
      kind: 'task',
      projectId: null,
      assigneeUserId: f.member.id,
      priority: 'urgent',
    })
    expect((await request(f.headSession, `/cards/${created.id}`, 'DELETE')).status).toBe(409)
    expect(
      (
        await request(f.headSession, path, 'POST', {
          ...input,
          operationId: randomUUID(),
          projectId: randomUUID(),
        })
      ).status,
    ).toBe(422)
  })

  it('rolls back task creation for a closed cycle or a foreign person', async () => {
    const f = await fixture(),
      other = await fixture(true)
    const input = {
      operationId: randomUUID(),
      title: `No orphan ${randomUUID()}`,
      checklist: ['Delivery'],
    }
    expect(
      (
        await request(
          f.headSession,
          `/checkins/cycles/${f.cycleId}/members/${other.member.id}/tasks`,
          'POST',
          input,
        )
      ).status,
    ).toBeGreaterThanOrEqual(400)
    await superuserQuery(
      db,
      'update app.checkin_cycles set checkin_locked_at=now(),checkout_locked_at=now() where id=$1',
      [f.cycleId],
    )
    expect(
      (
        await request(
          f.headSession,
          `/checkins/cycles/${f.cycleId}/members/${f.member.id}/tasks`,
          'POST',
          input,
        )
      ).status,
    ).toBe(409)
    expect(
      await superuserQuery(db, 'select id from app.cards where title=$1', [input.title]),
    ).toHaveLength(0)
  })

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
      (
        await request(f.session, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkin',
          memberUserId: f.member.id,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkin',
          memberUserId: f.member.id,
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
  it('source edits update a draft; agreed sources reject wording changes and deletion while progress can continue', async () => {
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
    ).toBe(409)
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
    ).toBe(409)
    expect((await read(f)).entries[0]).toMatchObject({
      text: 'Live revised result',
      state: 'done',
      sourceAvailable: true,
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
          memberUserId: b.member.id,
        })
      ).status,
    ).toBe(404)
  })
  it('locks only the selected member, including an empty check-in, and requires a valid member', async () => {
    const f = await fixture(),
      other = await fixture(true)
    const second = await seedMember(db, f.department.id, { role: 'member' })
    const id = await add(f)
    const lock = (memberUserId?: string) =>
      request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
        phase: 'checkin',
        ...(memberUserId ? { memberUserId } : {}),
      })
    expect((await lock()).status).toBe(422)
    expect((await lock(other.member.id)).status).toBe(404)
    expect((await lock(f.head.id)).status).toBe(404)
    expect((await lock(second.id)).status).toBe(204)
    const firstLock = (await read(f)).memberLocks.find((l) => l.memberUserId === second.id)
    expect(firstLock?.checkinLockedAt).toBeTruthy()
    expect((await lock(second.id)).status).toBe(204)
    expect((await read(f)).memberLocks.find((l) => l.memberUserId === second.id)).toEqual(firstLock)
    expect((await request(f.session, `/checkins/entries/${id}`, 'DELETE')).status).toBe(204)
    expect((await read(f)).cycles.find((c) => c.id === f.cycleId)?.checkinLockedAt).toBeNull()
    await superuserQuery(db, 'update app.cards set assignee_user_id=$1 where id=$2', [
      second.id,
      f.cardId,
    ])
    const itemId = randomUUID()
    await superuserQuery(
      db,
      "insert into app.card_checklist_items(id,department_id,card_id,text) values($1,$2,$3,'Second member')",
      [itemId, f.department.id, f.cardId],
    )
    const secondEntry = await add(f, itemId)
    expect((await request(f.session, `/checkins/entries/${secondEntry}`, 'DELETE')).status).toBe(
      409,
    )
    await expect(
      superuserQuery(db, 'update app.checkin_entries set removed_at=now() where id=$1', [
        secondEntry,
      ]),
    ).rejects.toThrow('checkin_locked')
  })
  it('freezes one checkout while another member can still edit and receive source updates', async () => {
    const f = await fixture()
    const second = await seedMember(db, f.department.id, { role: 'member' })
    const firstId = await add(f)
    const secondItem = randomUUID()
    await superuserQuery(
      db,
      "insert into app.card_checklist_items(id,department_id,card_id,assignee_user_id,text) values($1,$2,$3,$4,'Second result')",
      [secondItem, f.department.id, f.cardId, second.id],
    )
    const secondId = await add(f, secondItem)
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkout',
          memberUserId: f.member.id,
        })
      ).status,
    ).toBe(409)
    // Make this an earlier cycle whose scheduled cutoff is still open, to exercise manual checkout.
    await superuserQuery(
      db,
      "update app.checkin_cycles set starts_on=starts_on-14,ends_on=ends_on-14,checkin_deadline=now()+interval '1 day',checkout_deadline=now()+interval '2 days' where id=$1",
      [f.cycleId],
    )
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkout',
          memberUserId: f.member.id,
        })
      ).status,
    ).toBe(204)
    const frozen = (await read(f)).entries.find((e) => e.id === firstId)!
    await superuserQuery(
      db,
      'update app.card_checklist_items set done_at=now() where id=any($1::uuid[])',
      [[f.itemId, secondItem]],
    )
    await superuserQuery(
      db,
      "update app.card_checklist_items set text='Source revision' where id=$1",
      [secondItem],
    )
    await superuserQuery(db, "update app.cards set title='New title' where id=$1", [f.cardId])
    let board = await read(f)
    expect(board.entries.find((e) => e.id === firstId)).toMatchObject({
      text: frozen.text,
      state: frozen.state,
      cardTitle: frozen.cardTitle,
      version: frozen.version,
    })
    expect(board.entries.find((e) => e.id === secondId)).toMatchObject({
      text: 'Source revision',
      state: 'done',
      cardTitle: 'New title',
    })
    expect(
      (
        await request(f.session, `/checkins/entries/${firstId}`, 'PATCH', {
          version: frozen.version,
          text: 'Forbidden',
        })
      ).status,
    ).toBe(409)
    expect((await request(f.session, `/checkins/entries/${firstId}`, 'DELETE')).status).toBe(409)
    expect(
      (
        await request(f.session, `/checkins/cycles/${f.cycleId}/entries`, 'POST', {
          checklistItemId: f.itemId,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(f.session, `/checkins/entries/${secondId}`, 'PATCH', {
          version: board.entries.find((e) => e.id === secondId)!.version,
          text: 'Still editable',
        })
      ).status,
    ).toBe(204)
    expect((await request(f.session, `/checkins/entries/${secondId}`, 'DELETE')).status).toBe(204)
    board = await read(f)
    expect(board.entries).toHaveLength(1)
    expect(board.entries[0]).toMatchObject({
      id: frozen.id,
      text: frozen.text,
      state: frozen.state,
      version: frozen.version,
    })
  })
  it('saves selection atomically, protects every retained source, and advances completed tasks', async () => {
    const f = await fixture()
    const base = `/checkins/cycles/${f.cycleId}/members/${f.member.id}`
    const candidates = await request(f.session, `${base}/candidates`)
    expect(candidates.status).toBe(200)
    expect(await candidates.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: f.cardId,
          checklist: expect.arrayContaining([
            expect.objectContaining({ id: f.itemId, textLocked: false }),
          ]),
        }),
      ]),
    )
    expect(
      (
        await request(f.session, `${base}/selection`, 'PUT', {
          addItemIds: [f.itemId, randomUUID()],
          removeEntryIds: [],
        })
      ).status,
    ).toBe(409)
    expect((await read(f)).entries).toHaveLength(0)
    expect(
      (
        await request(f.session, `${base}/selection`, 'PUT', {
          addItemIds: [f.itemId],
          removeEntryIds: [],
        })
      ).status,
    ).toBe(204)
    expect((await request(f.session, `/cards/${f.cardId}`, 'DELETE')).status).toBe(409)
    expect(
      (await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'DELETE')).status,
    ).toBe(409)
    expect(
      (
        await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'PATCH', {
          done: true,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await superuserQuery<{ work_stage: string }>(
          db,
          'select work_stage from app.cards where id=$1',
          [f.cardId],
        )
      )[0]?.work_stage,
    ).toBe('in_progress')
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkin',
          memberUserId: f.member.id,
        })
      ).status,
    ).toBe(204)
    const entry = (await read(f)).entries[0]!
    expect(
      (
        await request(f.session, `${base}/selection`, 'PUT', {
          addItemIds: [],
          removeEntryIds: [entry.id],
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(f.session, `/cards/${f.cardId}/checklist/${f.itemId}`, 'PATCH', {
          text: 'Rewrite commitment',
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(f.session, `/cards/${f.cardId}`, 'PATCH', {
          title: 'Clearer task title',
          priority: 'urgent',
        })
      ).status,
    ).toBe(200)
    expect((await read(f)).entries[0]).toMatchObject({
      cardTitle: 'Clearer task title',
      cardPriority: 'urgent',
      text: 'Publish the report',
    })
  })
  it('persists manual order with version conflicts and rejects foreign member choices', async () => {
    const f = await fixture(),
      other = await fixture(true)
    const base = `/checkins/cycles/${f.cycleId}/members/${f.member.id}`
    expect(
      (
        await request(f.session, `${base}/layout`, 'PUT', {
          mode: 'manual',
          cardIds: [f.cardId],
          version: 0,
        })
      ).status,
    ).toBe(204)
    expect((await read(f)).layouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberUserId: f.member.id,
          mode: 'manual',
          cardIds: [f.cardId],
          version: 1,
        }),
      ]),
    )
    expect(
      (
        await request(f.session, `${base}/layout`, 'PUT', {
          mode: 'priority',
          cardIds: [],
          version: 0,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(f.session, `${base}/layout`, 'PUT', {
          mode: 'manual',
          cardIds: [other.cardId],
          version: 1,
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await request(f.session, `${base}/selection`, 'PUT', {
          addItemIds: [other.itemId],
          removeEntryIds: [],
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request(
          f.session,
          `/checkins/cycles/${other.cycleId}/members/${other.member.id}/candidates`,
        )
      ).status,
    ).toBe(404)
  })
  it('unlocks the first cycle across departments exactly once and preserves later locks', async () => {
    const f = await fixture(),
      other = await fixture(true)
    const id = await add(f)
    const second = await seedMember(db, f.department.id, { role: 'member' })
    await superuserQuery(
      db,
      `insert into app.checkin_member_locks(department_id,cycle_id,member_user_id,checkin_locked_at,checkout_locked_at)
      values($1,$2,$3,now(),now()),($1,$2,$4,now(),null)`,
      [f.department.id, f.cycleId, f.member.id, second.id],
    )
    await superuserQuery(
      db,
      'update app.checkin_cycles set checkin_locked_at=now(),checkout_locked_at=now()',
      [],
    )
    await superuserQuery(
      db,
      "insert into app.checkin_cycles(department_id,starts_on,ends_on,checkin_deadline,checkout_deadline,checkin_locked_at) values($1,'2026-11-16','2026-11-27','2026-11-17T00:00:00+05:00','2026-11-28T00:00:00+05:00',now())",
      [f.department.id],
    )
    const name = '2021_checkin_initial_unlock.sql'
    const rollout = {
      name,
      sql: readFileSync(
        new URL(`../../../../packages/db/migrations/${name}`, import.meta.url),
        'utf8',
      ),
    }
    expect((await applyMigrations(db.superuserUrl, {}, [rollout])).applied).toEqual([name])
    const first = await read(f)
    expect(first.cycles.find((c) => c.id === f.cycleId)).toMatchObject({
      checkinLockedAt: null,
      checkoutLockedAt: null,
    })
    expect(first.memberLocks.filter((l) => l.cycleId === f.cycleId)).toHaveLength(2)
    expect(first.memberLocks.every((l) => !l.checkinLockedAt && !l.checkoutLockedAt)).toBe(true)
    expect((await read(other)).cycles.find((c) => c.id === other.cycleId)).toMatchObject({
      checkinLockedAt: null,
      checkoutLockedAt: null,
    })
    expect((await request(f.session, `/checkins/entries/${id}`, 'DELETE')).status).toBe(204)
    expect(first.cycles.find((c) => c.startsOn === '2026-11-16')?.checkinLockedAt).toBeTruthy()
    expect(
      (
        await request(f.headSession, `/checkins/cycles/${f.cycleId}/lock`, 'POST', {
          phase: 'checkin',
          memberUserId: f.member.id,
        })
      ).status,
    ).toBe(204)
    expect((await applyMigrations(db.superuserUrl, {}, [rollout])).applied).toEqual([])
    expect(
      (await read(f)).memberLocks.find((l) => l.memberUserId === f.member.id)?.checkinLockedAt,
    ).toBeTruthy()
    expect(
      (await read(f)).memberLocks.find((l) => l.memberUserId === second.id)?.checkinLockedAt,
    ).toBeNull()
  })
})

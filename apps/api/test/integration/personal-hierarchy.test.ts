import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TaskDto as Task } from '../../src/modules/personal/schemas.js'
import {
  loginAs,
  seedBareUser,
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
let foreignSession: Session
let userId: string
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const owner = await seedBareUser(db)
  const foreign = await seedBareUser(db)
  userId = owner.id
  session = await loginAs(server.baseUrl, owner.login)
  foreignSession = await loginAs(server.baseUrl, foreign.login)
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})
function request(path: string, method = 'GET', body?: unknown, actor = session) {
  const headers = { ...actor.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/personal/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function task(extra: Record<string, unknown> = {}, actor = session): Promise<Task> {
  const response = await request(
    'tasks',
    'POST',
    { title: `Hierarchy ${randomUUID()}`, ...extra },
    actor,
  )
  expect(response.status).toBe(201)
  return (await response.json()) as Task
}
async function sprint(actor = session) {
  const response = await request(
    'sprints',
    'POST',
    { kind: 'week', startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z' },
    actor,
  )
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}
async function effects() {
  return {
    tasks: await superuserQuery(
      db,
      'select id,user_id,parent_id,sprint_id,sort,version,deleted_at from app.personal_tasks order by id',
    ),
    audit: await superuserQuery(db, 'select id,action from audit.events order by seq'),
  }
}
async function taskStates(ids: string[]) {
  return superuserQuery<{
    id: string
    parent_id: string | null
    sprint_id: string | null
    version: number
    deleted: boolean
    done: boolean
  }>(
    db,
    'select id,parent_id,sprint_id,version,deleted_at is not null as deleted,done_at is not null as done from app.personal_tasks where id=any($1::uuid[]) order by id',
    [ids],
  )
}
async function blockedBy(blocker: number, count = 1) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiters = await superuserQuery(
      db,
      `with recursive waiting as (
      select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))
      union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
    ) select pid from waiting`,
      [blocker],
    )
    if (waiters.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected actual personal hierarchy write lock waiters')
}
describe('personal task hierarchy boundary regressions', () => {
  it('acknowledges exact committed patch revisions including implicit active descendants only', async () => {
    const source = await sprint()
    const destination = await sprint()
    const root = await task({ sprintId: source.id })
    const child = await task({ parentId: root.id })
    const historical = await task({ parentId: root.id })
    const foreign = await task({}, foreignSession)
    expect((await request(`tasks/${historical.id}`, 'DELETE')).status).toBe(204)
    expect(
      (await request(`tasks/${child.id}`, 'PATCH', { version: child.version, done: true })).status,
    ).toBe(200)
    const response = await request(`tasks/${root.id}?versions=true`, 'PATCH', {
      version: root.version,
      sprintId: destination.id,
    })
    expect(response.status).toBe(200)
    const receipt = (await response.json()) as {
      task: Task
      affectedVersions: { id: string; beforeVersion: number; afterVersion: number }[]
    }
    expect(receipt.task).toMatchObject({
      id: root.id,
      version: root.version + 1,
      sprintId: destination.id,
    })
    expect(receipt.affectedVersions.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: root.id, beforeVersion: root.version, afterVersion: root.version + 1 },
        { id: child.id, beforeVersion: child.version + 1, afterVersion: child.version + 2 },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
    const persisted = await taskStates(receipt.affectedVersions.map((row) => row.id))
    for (const row of receipt.affectedVersions)
      expect(persisted.find((value) => value.id === row.id)?.version).toBe(row.afterVersion)
    expect(
      receipt.affectedVersions.some((row) => row.id === historical.id || row.id === foreign.id),
    ).toBe(false)
    const conflict = await request(`tasks/${root.id}?versions=true`, 'PATCH', {
      version: root.version,
      done: true,
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).not.toHaveProperty('affectedVersions')
  })
  it('acknowledges explicit reorder rows and only descendants actually changed in the transaction', async () => {
    const source = await sprint()
    const destination = await sprint()
    const branch = await task({ sprintId: source.id })
    const child = await task({ parentId: branch.id })
    const unrelated = await task({ sprintId: source.id })
    const response = await request('tasks/reorder?versions=true', 'POST', {
      items: [
        { id: branch.id, sort: 9, sprintId: destination.id },
        { id: unrelated.id, sort: 3 },
      ],
    })
    expect(response.status).toBe(200)
    const receipt = (await response.json()) as {
      updated: number
      affectedVersions: { id: string; beforeVersion: number; afterVersion: number }[]
    }
    expect(receipt.updated).toBe(3)
    expect(receipt.affectedVersions.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [branch, child, unrelated]
        .map((row) => ({ id: row.id, beforeVersion: row.version, afterVersion: row.version + 1 }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    )
    const legacy = await request('tasks/reorder', 'POST', {
      items: [{ id: unrelated.id, sort: 4 }],
    })
    expect(legacy.status).toBe(200)
    expect(await legacy.json()).toEqual({ updated: 1 })
  })
  it('does not attribute a remotely detached child revision to a later branch move', async () => {
    const source = await sprint()
    const destination = await sprint()
    const root = await task({ sprintId: source.id })
    const child = await task({ parentId: root.id })
    // A second authenticated session for the same owner is the actual other-client boundary.
    const login = (
      await superuserQuery<{ login: string }>(db, 'select login from app.users where id=$1', [
        userId,
      ])
    )[0]!.login
    const other = await loginAs(server.baseUrl, login)
    expect(
      (
        await request(
          `tasks/${child.id}`,
          'PATCH',
          { version: child.version, sprintId: destination.id },
          other,
        )
      ).status,
    ).toBe(200)
    const response = await request(`tasks/${root.id}?versions=true`, 'PATCH', {
      version: root.version,
      sprintId: destination.id,
    })
    expect(response.status).toBe(200)
    const receipt = (await response.json()) as {
      affectedVersions: { id: string; beforeVersion: number; afterVersion: number }[]
    }
    expect(receipt.affectedVersions).toEqual([
      { id: root.id, beforeVersion: root.version, afterVersion: root.version + 1 },
    ])
    expect(
      (
        await request(`tasks/${child.id}?versions=true`, 'PATCH', {
          version: child.version,
          done: true,
        })
      ).status,
    ).toBe(409)
    expect((await taskStates([child.id]))[0]).toMatchObject({
      version: child.version + 1,
      parent_id: null,
      sprint_id: destination.id,
      done: false,
    })
  })
  it('refuses foreign and deleted parent/period references on create before any effects', async () => {
    const foreign = await task({}, foreignSession)
    const foreignSprint = await sprint(foreignSession)
    const deletedParent = await task()
    const deletedSprint = await sprint()
    expect((await request(`tasks/${deletedParent.id}`, 'DELETE')).status).toBe(204)
    await superuserQuery(db, 'update app.personal_sprints set deleted_at=now() where id=$1', [
      deletedSprint.id,
    ])
    const before = await effects()
    const inputs = [
      { parentId: foreign.id },
      { sprintId: foreignSprint.id },
      { parentId: deletedParent.id },
      { sprintId: deletedSprint.id },
    ]
    const responses = await Promise.all(
      inputs.map((input) =>
        request('tasks', 'POST', { title: 'Refuse unsafe reference', ...input }),
      ),
    )
    expect.soft(responses.map((response) => response.status)).toEqual([422, 422, 422, 422])
    expect(await effects()).toEqual(before)
  })
  it('refuses foreign/deleted references on patch with version and audit untouched', async () => {
    const foreign = await task({}, foreignSession)
    const deleted = await task()
    await request(`tasks/${deleted.id}`, 'DELETE')
    const foreignSprint = await sprint(foreignSession)
    const ownerTasks = await Promise.all([0, 1, 2].map(() => task()))
    const before = await effects()
    const responses = await Promise.all(
      ownerTasks.map((item, index) =>
        request(`tasks/${item.id}`, 'PATCH', {
          version: item.version,
          ...(index === 0
            ? { parentId: foreign.id }
            : index === 1
              ? { parentId: deleted.id }
              : { sprintId: foreignSprint.id }),
        }),
      ),
    )
    expect.soft(responses.map((response) => response.status)).toEqual([422, 422, 422])
    expect(await effects()).toEqual(before)
  })
  it('refuses a mixed-owner reorder batch atomically instead of silently applying the accessible subset', async () => {
    const own = await task()
    const foreign = await task({}, foreignSession)
    const before = await effects()
    const response = await request('tasks/reorder', 'POST', {
      items: [
        { id: own.id, sort: 8 },
        { id: foreign.id, sort: 9 },
      ],
    })
    expect.soft(response.status).toBe(422)
    expect(await effects()).toEqual(before)
  })
  it('refuses a simultaneous two-node cycle, which otherwise disappears from the actual task-tree renderer', async () => {
    const first = await task()
    const second = await task()
    const before = await effects()
    const response = await request('tasks/reorder', 'POST', {
      items: [
        { id: first.id, sort: 0, parentId: second.id },
        { id: second.id, sort: 0, parentId: first.id },
      ],
    })
    expect.soft(response.status).toBe(422)
    const listResponse = await request('tasks')
    const all = (await listResponse.json()) as Task[]
    const pair = all.filter((item) => item.id === first.id || item.id === second.id)
    expect.soft(pair.map((item) => item.parentId)).toEqual([null, null])
    expect(await effects()).toEqual(before)
  })
  it('moves the active descendant tree with a root period change while historical deleted children stay untouched', async () => {
    const source = await sprint()
    const destination = await sprint()
    const parent = await task({ sprintId: source.id })
    const child = await task({ sprintId: source.id, parentId: parent.id })
    const grandchild = await task({ sprintId: source.id, parentId: child.id })
    const historical = await task({ sprintId: source.id, parentId: parent.id })
    await request(`tasks/${historical.id}`, 'DELETE')
    const historicalBefore = await superuserQuery(
      db,
      'select sprint_id,parent_id,version,deleted_at from app.personal_tasks where id=$1',
      [historical.id],
    )
    expect(
      (
        await request(`tasks/${parent.id}`, 'PATCH', {
          version: parent.version,
          sprintId: destination.id,
        })
      ).status,
    ).toBe(200)
    const persisted = await superuserQuery<{
      id: string
      sprint_id: string
      parent_id: string | null
    }>(db, 'select id,sprint_id,parent_id from app.personal_tasks where id=any($1::uuid[])', [
      [parent.id, child.id, grandchild.id],
    ])
    expect.soft(persisted.map((row) => row.sprint_id)).toEqual(persisted.map(() => destination.id))
    expect(
      await superuserQuery(
        db,
        'select sprint_id,parent_id,version,deleted_at from app.personal_tasks where id=$1',
        [historical.id],
      ),
    ).toEqual(historicalBefore)
  })
  it('inherits the parent period on create and refuses contradictory explicit placement without effects', async () => {
    const source = await sprint()
    const other = await sprint()
    const parent = await task({ sprintId: source.id })
    const child = await task({ parentId: parent.id })
    expect(child).toMatchObject({ parentId: parent.id, sprintId: source.id })
    const before = await effects()
    for (const sprintId of [null, other.id]) {
      expect(
        (
          await request('tasks', 'POST', {
            title: 'Invalid child period',
            parentId: parent.id,
            sprintId,
          })
        ).status,
      ).toBe(422)
    }
    expect(await effects()).toEqual(before)
  })
  it('rejects self/ancestor nesting and checks version conflict before unsafe-reference validation', async () => {
    const parent = await task()
    const child = await task({ parentId: parent.id })
    const before = await effects()
    for (const parentId of [parent.id, child.id]) {
      expect(
        (await request(`tasks/${parent.id}`, 'PATCH', { version: parent.version, parentId }))
          .status,
      ).toBe(422)
    }
    expect(
      (
        await request(`tasks/${parent.id}`, 'PATCH', {
          version: parent.version + 100,
          parentId: randomUUID(),
        })
      ).status,
    ).toBe(409)
    expect(await effects()).toEqual(before)
  })
  it('refuses duplicate/deleted batch targets and bad parent/period references before applying any subset', async () => {
    const first = await task()
    const deleted = await task()
    const foreign = await task({}, foreignSession)
    const foreignPeriod = await sprint(foreignSession)
    await request(`tasks/${deleted.id}`, 'DELETE')
    const before = await effects()
    const batches = [
      [
        { id: first.id, sort: 8 },
        { id: first.id, sort: 9 },
      ],
      [
        { id: first.id, sort: 8 },
        { id: deleted.id, sort: 9 },
      ],
      [{ id: first.id, sort: 8, parentId: foreign.id }],
      [{ id: first.id, sort: 8, parentId: deleted.id }],
      [{ id: first.id, sort: 8, sprintId: foreignPeriod.id }],
    ]
    for (const items of batches)
      expect((await request('tasks/reorder', 'POST', { items })).status).toBe(422)
    expect(await effects()).toEqual(before)
  })
  it('resolves mixed reparent/period batches against their final graph and carries completed active descendants', async () => {
    const source = await sprint()
    const destination = await sprint()
    const target = await task({ sprintId: source.id })
    const branch = await task({ sprintId: source.id })
    const child = await task({ parentId: branch.id })
    expect(
      (await request(`tasks/${child.id}`, 'PATCH', { version: child.version, done: true })).status,
    ).toBe(200)
    const response = await request('tasks/reorder', 'POST', {
      items: [
        { id: branch.id, parentId: target.id, sort: 0 },
        { id: target.id, sprintId: destination.id, sort: 3 },
      ],
    })
    expect(response.status).toBe(200)
    const rows = await taskStates([target.id, branch.id, child.id])
    expect(rows.find((row) => row.id === branch.id)).toMatchObject({
      parent_id: target.id,
      sprint_id: destination.id,
    })
    expect(rows.find((row) => row.id === child.id)).toMatchObject({
      parent_id: branch.id,
      sprint_id: destination.id,
      done: true,
    })
    expect(rows.find((row) => row.id === target.id)).toMatchObject({
      parent_id: null,
      sprint_id: destination.id,
    })
    const before = await effects()
    expect(
      (
        await request('tasks/reorder', 'POST', {
          items: [
            { id: target.id, sprintId: source.id, sort: 0 },
            { id: branch.id, parentId: target.id, sprintId: destination.id, sort: 0 },
          ],
        })
      ).status,
    ).toBe(422)
    expect(await effects()).toEqual(before)
  })
  it('detaches a nested branch on a sprint-only move, while a new parent determines the period for the whole branch', async () => {
    const source = await sprint()
    const destination = await sprint()
    const parent = await task({ sprintId: source.id })
    const branch = await task({ parentId: parent.id })
    const child = await task({ parentId: branch.id })
    const response = await request(`tasks/${branch.id}`, 'PATCH', {
      version: branch.version,
      sprintId: destination.id,
    })
    expect(response.status).toBe(200)
    const moved = (await response.json()) as Task
    expect(moved).toMatchObject({ parentId: null, sprintId: destination.id })
    expect((await taskStates([child.id]))[0]).toMatchObject({
      parent_id: branch.id,
      sprint_id: destination.id,
    })
    const newParent = await task()
    const reparented = await request(`tasks/${branch.id}`, 'PATCH', {
      version: moved.version,
      parentId: newParent.id,
    })
    expect(reparented.status).toBe(200)
    expect((await taskStates([branch.id, child.id])).every((row) => row.sprint_id === null)).toBe(
      true,
    )
    expect((await taskStates([parent.id]))[0]).toMatchObject({
      sprint_id: source.id,
      version: parent.version,
    })
  })
  it('rolls over unfinished rows only, detaching both directions of split branches and preserving deleted history', async () => {
    const source = await sprint()
    const completedParent = await task({ sprintId: source.id })
    const unfinishedChild = await task({ parentId: completedParent.id })
    const completedGrandchild = await task({ parentId: unfinishedChild.id })
    const unfinishedParent = await task({ sprintId: source.id })
    const completedChild = await task({ parentId: unfinishedParent.id })
    const unfinishedGrandchild = await task({ parentId: completedChild.id })
    const historical = await task({ parentId: unfinishedParent.id })
    for (const row of [completedParent, completedGrandchild, completedChild]) {
      expect(
        (await request(`tasks/${row.id}`, 'PATCH', { version: row.version, done: true })).status,
      ).toBe(200)
    }
    await request(`tasks/${historical.id}`, 'DELETE')
    const historicalBefore = await taskStates([historical.id])
    const response = await request(`sprints/${source.id}/rollover`, 'POST', {
      startsAt: '2026-10-12T00:00:00Z',
      endsAt: '2026-10-19T00:00:00Z',
    })
    expect(response.status).toBe(200)
    const result = (await response.json()) as { sprint: { id: string }; movedTaskCount: number }
    expect(result.movedTaskCount).toBe(3)
    const rows = await taskStates([
      completedParent.id,
      unfinishedChild.id,
      completedGrandchild.id,
      unfinishedParent.id,
      completedChild.id,
      unfinishedGrandchild.id,
    ])
    for (const row of rows)
      expect(row).toMatchObject({
        parent_id: null,
        sprint_id: row.done ? source.id : result.sprint.id,
      })
    expect(await taskStates([historical.id])).toEqual(historicalBefore)
  })
  it('rolls back a whole branch patch and a mixed reorder if auditing refuses the transaction', async () => {
    const source = await sprint()
    const destination = await sprint()
    const root = await task({ sprintId: source.id })
    await task({ parentId: root.id })
    const target = await task({ sprintId: destination.id })
    const before = await effects()
    await superuserQuery(
      db,
      `create function public.qa_refuse_hierarchy() returns trigger language plpgsql as $$
      begin if new.actor_user_id='${userId}' and new.action='personal.task.reordered' then raise exception 'QA intentional hierarchy audit refusal'; end if; return new; end $$`,
    )
    await superuserQuery(
      db,
      'create trigger qa_refuse_hierarchy before insert on audit.events for each row execute function public.qa_refuse_hierarchy()',
    )
    try {
      expect(
        (
          await request(`tasks/${root.id}`, 'PATCH', {
            version: root.version,
            sprintId: destination.id,
          })
        ).status,
      ).toBe(500)
      expect(await effects()).toEqual(before)
      expect(
        (
          await request('tasks/reorder', 'POST', {
            items: [
              { id: root.id, parentId: target.id, sort: 0 },
              { id: target.id, sort: 4 },
            ],
          })
        ).status,
      ).toBe(500)
      expect(await effects()).toEqual(before)
    } finally {
      await superuserQuery(db, 'drop trigger qa_refuse_hierarchy on audit.events')
      await superuserQuery(db, 'drop function public.qa_refuse_hierarchy()')
    }
  })
  it('restores the same-operation branch into its active parent’s current period after a parent move', async () => {
    const source = await sprint()
    const destination = await sprint()
    const parent = await task({ sprintId: source.id })
    const child = await task({ parentId: parent.id })
    const grandchild = await task({ parentId: child.id })
    const response = await request(`tasks/${child.id}?receipt=true`, 'DELETE')
    const receipt = (await response.json()) as { restoreToken: string }
    expect(
      (
        await request(`tasks/${parent.id}`, 'PATCH', {
          version: parent.version,
          sprintId: destination.id,
        })
      ).status,
    ).toBe(200)
    expect((await request(`tasks/${child.id}/restore`, 'POST', receipt)).status).toBe(200)
    for (const row of await taskStates([child.id, grandchild.id]))
      expect(row).toMatchObject({ sprint_id: destination.id, deleted: false })
  })
  it('keeps legacy malformed rows editable and allows explicit safe structural recovery without automatic writes', async () => {
    const first = await task()
    const second = await task()
    await superuserQuery(
      db,
      'update app.personal_tasks set parent_id=case when id=$1 then $2::uuid else $1::uuid end where id=any($3::uuid[])',
      [first.id, second.id, [first.id, second.id]],
    )
    const title = await request(`tasks/${first.id}`, 'PATCH', {
      version: first.version,
      title: 'Recover this task',
    })
    expect(title.status).toBe(200)
    const updated = (await title.json()) as Task
    expect(updated.parentId).toBe(second.id)
    expect(
      (await request(`tasks/${first.id}`, 'PATCH', { version: updated.version, parentId: null }))
        .status,
    ).toBe(200)
    const rows = await taskStates([first.id, second.id])
    expect(rows.find((row) => row.id === first.id)?.parent_id).toBeNull()
    expect(rows.find((row) => row.id === second.id)?.parent_id).toBe(first.id)
  })
  it.each(['delete-first', 'create-first'] as const)(
    'linearizes a parent deletion and child creation: %s',
    async (order) => {
      const parent = await task()
      const blocker = new Client({ connectionString: db.superuserUrl })
      await blocker.connect()
      await blocker.query('begin')
      await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `personal.tasks:${userId}`,
      ])
      const pid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!
        .pid
      try {
        const create = () =>
          request('tasks', 'POST', { title: 'Concurrent child', parentId: parent.id })
        const remove = () => request(`tasks/${parent.id}`, 'DELETE')
        const first = order === 'delete-first' ? remove() : create()
        await blockedBy(pid)
        const second = order === 'delete-first' ? create() : remove()
        await blockedBy(pid, 2)
        await blocker.query('commit')
        const responses = await Promise.all([first, second])
        expect(responses.map((response) => response.status)).toEqual(
          order === 'delete-first' ? [204, 422] : [201, 204],
        )
        if (order === 'create-first') {
          const created = (await responses[0]!.json()) as Task
          expect((await taskStates([created.id]))[0]?.deleted).toBe(true)
        }
        expect((await taskStates([parent.id]))[0]?.deleted).toBe(true)
      } finally {
        await blocker.query('rollback')
        await blocker.end()
      }
    },
  )
  it('refuses repeated rollover and completed/archived source periods without new rows or audits', async () => {
    const body = { startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-19T00:00:00Z' }
    const source = await sprint()
    expect((await request(`sprints/${source.id}/rollover`, 'POST', body)).status).toBe(200)
    for (const status of ['completed', 'archived']) {
      const item = status === 'completed' ? source : await sprint()
      if (status === 'archived')
        expect((await request(`sprints/${item.id}`, 'PATCH', { version: 1, status })).status).toBe(
          200,
        )
      const before = {
        effects: await effects(),
        periods: await superuserQuery(
          db,
          'select id,status,goal,version from app.personal_sprints order by id',
        ),
      }
      expect.soft((await request(`sprints/${item.id}/rollover`, 'POST', body)).status).toBe(409)
      expect
        .soft({
          effects: await effects(),
          periods: await superuserQuery(
            db,
            'select id,status,goal,version from app.personal_sprints order by id',
          ),
        })
        .toEqual(before)
    }
  })
  it.each(['patch-first', 'rollover-first'] as const)(
    'linearizes source edits and rollover, preserving committed goal and version: %s',
    async (order) => {
      const source = await sprint()
      const blocker = new Client({ connectionString: db.superuserUrl })
      await blocker.connect()
      await blocker.query('begin')
      await blocker.query('select id from app.personal_sprints where id=$1 for update', [source.id])
      const pid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!
        .pid
      try {
        const patch = () =>
          request(`sprints/${source.id}`, 'PATCH', { version: 1, goal: 'Latest committed goal' })
        const rollover = () =>
          request(`sprints/${source.id}/rollover`, 'POST', {
            startsAt: '2026-10-12T00:00:00Z',
            endsAt: '2026-10-19T00:00:00Z',
          })
        const first = order === 'patch-first' ? patch() : rollover()
        await blockedBy(pid)
        const second = order === 'patch-first' ? rollover() : patch()
        await blockedBy(pid, 2)
        await blocker.query('commit')
        const responses = await Promise.all([first, second])
        expect(responses.map((response) => response.status)).toEqual(
          order === 'patch-first' ? [200, 200] : [200, 409],
        )
        const result = (await responses[order === 'patch-first' ? 1 : 0]!.json()) as {
          sprint: { id: string; goal: string | null }
        }
        expect
          .soft(result.sprint.goal)
          .toBe(order === 'patch-first' ? 'Latest committed goal' : null)
        const persisted = await superuserQuery<{
          goal: string | null
          status: string
          version: number
        }>(db, 'select goal,status,version from app.personal_sprints where id=$1', [source.id])
        expect(persisted[0]).toEqual({
          goal: order === 'patch-first' ? 'Latest committed goal' : null,
          status: 'completed',
          version: order === 'patch-first' ? 3 : 2,
        })
      } finally {
        await blocker.query('rollback')
        await blocker.end()
      }
    },
  )
})

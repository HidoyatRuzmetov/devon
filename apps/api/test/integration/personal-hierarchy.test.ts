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
async function effects() {
  return {
    tasks: await superuserQuery(
      db,
      'select id,user_id,parent_id,sort,version,deleted_at from app.personal_tasks order by id',
    ),
    audit: await superuserQuery(db, 'select id,action from audit.events order by seq'),
  }
}
async function taskStates(ids: string[]) {
  return superuserQuery<{
    id: string
    parent_id: string | null
    version: number
    deleted: boolean
    done: boolean
  }>(
    db,
    'select id,parent_id,version,deleted_at is not null as deleted,done_at is not null as done from app.personal_tasks where id=any($1::uuid[]) order by id',
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

  it('reparents a branch without rewriting child revisions, and reports only changed rows', async () => {
    const root = await task(),
      child = await task({ parentId: root.id }),
      target = await task()
    const response = await request(`tasks/${root.id}?versions=true`, 'PATCH', {
      parentId: target.id,
      version: root.version,
    })
    expect(response.status).toBe(200)
    const updated = (await response.json()) as {
      task: Task
      affectedVersions: { id: string; beforeVersion: number; afterVersion: number }[]
    }
    expect(updated.task).toMatchObject({ parentId: target.id, version: root.version + 1 })
    expect(updated.affectedVersions).toEqual([
      { id: root.id, beforeVersion: root.version, afterVersion: root.version + 1 },
    ])
    const children = await taskStates([child.id])
    expect(children[0]).toMatchObject({ parent_id: root.id, version: child.version })
  })
  it('rejects foreign/deleted parents for creation and patching without any side effects', async () => {
    const foreign = await task({}, foreignSession),
      deleted = await task(),
      own = await task()
    await request(`tasks/${deleted.id}`, 'DELETE')
    const before = await effects()
    for (const parentId of [foreign.id, deleted.id, randomUUID()]) {
      expect((await request('tasks', 'POST', { title: 'Invalid parent', parentId })).status).toBe(
        422,
      )
      expect(
        (await request(`tasks/${own.id}`, 'PATCH', { parentId, version: own.version })).status,
      ).toBe(422)
    }
    expect(await effects()).toEqual(before)
  })
  it('rejects duplicate, missing and deleted reorder targets atomically', async () => {
    const own = await task(),
      deleted = await task()
    await request(`tasks/${deleted.id}`, 'DELETE')
    const before = await effects()
    for (const items of [
      [
        { id: own.id, sort: 1 },
        { id: own.id, sort: 2 },
      ],
      [
        { id: own.id, sort: 1 },
        { id: deleted.id, sort: 2 },
      ],
      [
        { id: own.id, sort: 1 },
        { id: randomUUID(), sort: 2 },
      ],
    ])
      expect((await request('tasks/reorder', 'POST', { items })).status).toBe(422)
    expect(await effects()).toEqual(before)
  })
  it('resolves simultaneous reparenting against the final graph and preserves completed descendants', async () => {
    const first = await task(),
      second = await task(),
      child = await task({ parentId: first.id })
    await request(`tasks/${child.id}`, 'PATCH', { done: true, version: child.version })
    const response = await request('tasks/reorder', 'POST', {
      items: [
        { id: first.id, parentId: second.id, sort: 0 },
        { id: second.id, parentId: null, sort: 0 },
      ],
    })
    expect(response.status).toBe(200)
    const state = await taskStates([first.id, second.id, child.id])
    expect(state.find((r) => r.id === first.id)?.parent_id).toBe(second.id)
    expect(state.find((r) => r.id === child.id)).toMatchObject({
      parent_id: first.id,
      done: true,
      version: child.version + 1,
    })
  })
  it('rolls back a mixed reorder when its audit cannot be persisted', async () => {
    const first = await task(),
      second = await task(),
      before = await effects()
    await superuserQuery(
      db,
      `create function public.qa_refuse_hierarchy() returns trigger language plpgsql as $$ begin if new.actor_user_id='${userId}' and new.action='personal.task.reordered' then raise exception 'QA intentional hierarchy audit refusal'; end if; return new; end $$`,
    )
    await superuserQuery(
      db,
      'create trigger qa_refuse_hierarchy before insert on audit.events for each row execute function public.qa_refuse_hierarchy()',
    )
    try {
      expect(
        (
          await request('tasks/reorder', 'POST', {
            items: [
              { id: first.id, parentId: second.id, sort: 3 },
              { id: second.id, sort: 4 },
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
})

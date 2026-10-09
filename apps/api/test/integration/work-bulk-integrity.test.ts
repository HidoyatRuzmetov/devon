import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  loginAs,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Bulk integrity',
    slug: `bulk-${randomUUID()}`,
  })
  const foreign = await seedDepartment(db, {
    name: 'Other bulk department',
    slug: `bulk-other-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const target = await seedMember(db, foreign.id, { role: 'member' })
  const session = await loginAs(server.baseUrl, head.login)
  const [label] = await superuserQuery<{ id: string }>(
    db,
    "insert into app.labels(department_id,name) values($1,'Foreign label') returning id",
    [foreign.id],
  )
  const ids: string[] = []
  for (const title of ['First selected', 'Second selected']) {
    const response = await request(session, '/cards', { title, kind: 'task' })
    expect(response.status).toBe(201)
    ids.push(((await response.json()) as { id: string }).id)
  }
  return { department, session, target, label: label!, ids }
}
function request(session: Session, path: string, data: unknown) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify(data),
  })
}
async function rows(ids: string[]) {
  return superuserQuery<{
    id: string
    assignee_user_id: string | null
    labels: string[]
    priority: string
    version: number
  }>(
    db,
    'select id,assignee_user_id,labels,priority,version from app.cards where id=any($1::uuid[]) order by id',
    [ids],
  )
}
async function transaction() {
  const client = new Client({ connectionString: db.superuserUrl })
  await client.connect()
  await client.query('begin')
  return client
}
async function blockedBy(client: Client) {
  const blocker = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!
    .pid
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiters = await superuserQuery<{ pid: number }>(
      db,
      'select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))',
      [blocker],
    )
    if (waiters.length) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected bulk target validation to wait for the real database lock')
}
describe('bulk target integrity and atomic undo', () => {
  it.each(['assignee', 'label'])(
    'refuses a foreign %s before modifying any selected card',
    async (kind) => {
      const f = await fixture()
      const before = await rows(f.ids)
      const patch =
        kind === 'assignee' ? { assigneeUserId: f.target.id } : { addLabelIds: [f.label.id] }
      const response = await request(f.session, '/cards/bulk', { ids: f.ids, patch })
      expect.soft(response.status).toBe(422)
      expect(await rows(f.ids)).toEqual(before)
    },
  )
  it('invalid later undo target rolls back all prior entries', async () => {
    const f = await fixture()
    const changed = await request(f.session, '/cards/bulk', {
      ids: f.ids,
      patch: { priority: 'high' },
    })
    expect(changed.status).toBe(200)
    const result = (await changed.json()) as {
      undo: { id: string; assigneeUserId: string | null }[]
    }
    const before = await rows(f.ids)
    const entries = result.undo.map((entry, i) =>
      i === 1 ? { ...entry, assigneeUserId: f.target.id } : entry,
    )
    const response = await request(f.session, '/cards/bulk/undo', { entries })
    expect.soft(response.status).toBe(422)
    expect(await rows(f.ids)).toEqual(before)
  })
  it.each(['assignee', 'label'])(
    'rechecks a concurrently removed %s before any bulk write',
    async (kind) => {
      const f = await fixture()
      const member = await seedMember(db, f.department.id, { role: 'member' })
      const [label] = await superuserQuery<{ id: string }>(
        db,
        "insert into app.labels(department_id,name) values($1,'Race label') returning id",
        [f.department.id],
      )
      const before = await rows(f.ids)
      const removal = await transaction()
      try {
        if (kind === 'assignee')
          await removal.query(
            "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
            [f.department.id, member.id],
          )
        else await removal.query('update app.labels set deleted_at=now() where id=$1', [label!.id])
        const writing = request(f.session, '/cards/bulk', {
          ids: f.ids,
          patch: kind === 'assignee' ? { assigneeUserId: member.id } : { addLabelIds: [label!.id] },
        })
        await blockedBy(removal)
        await removal.query('commit')
        expect((await writing).status).toBe(422)
        expect(await rows(f.ids)).toEqual(before)
      } finally {
        await removal.query('rollback')
        await removal.end()
      }
    },
  )
  it('restores each mixed label set, including an empty set, through Undo', async () => {
    const f = await fixture()
    const labels = await superuserQuery<{ id: string }>(
      db,
      "insert into app.labels(department_id,name) values($1,'Original'),($1,'Added') returning id",
      [f.department.id],
    )
    await superuserQuery(db, 'update app.cards set labels=$1::uuid[] where id=$2', [
      [labels[0]!.id],
      f.ids[0],
    ])
    const before = await rows(f.ids)
    const changed = await request(f.session, '/cards/bulk', {
      ids: f.ids,
      patch: { addLabelIds: [labels[1]!.id] },
    })
    expect(changed.status).toBe(200)
    const result = (await changed.json()) as { undo: unknown[] }
    const restored = await request(f.session, '/cards/bulk/undo', { entries: result.undo })
    expect(restored.status).toBe(200)
    expect((await rows(f.ids)).map(({ version: _version, ...row }) => row)).toEqual(
      before.map(({ version: _version, ...row }) => row),
    )
    expect((await rows(f.ids)).map((row) => row.version)).toEqual(
      before.map((row) => row.version + 2),
    )
  })
})

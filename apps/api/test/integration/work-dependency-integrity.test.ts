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

function post(session: Session, path: string, data: unknown) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify(data),
  })
}
async function fixture(count: number) {
  const department = await seedDepartment(db, {
    name: 'Dependency integrity',
    slug: `deps-${randomUUID()}`,
  })
  await superuserQuery(
    db,
    `update app.departments set features='{"dependencies":true}'::jsonb where id=$1`,
    [department.id],
  )
  const head = await seedMember(db, department.id, { role: 'head' })
  const session = await loginAs(server.baseUrl, head.login)
  const ids: string[] = []
  for (let index = 0; index < count; index++) {
    const response = await post(session, '/cards', {
      title: `Dependency card ${index}`,
      kind: 'task',
    })
    expect(response.status).toBe(201)
    ids.push(((await response.json()) as { id: string }).id)
  }
  return { department, session, ids }
}
async function edges(departmentId: string) {
  return superuserQuery<{ card_id: string; blocked_by_card_id: string }>(
    db,
    'select card_id,blocked_by_card_id from app.card_dependencies where department_id=$1',
    [departmentId],
  )
}
async function blockedBy(client: Client) {
  const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiters = await superuserQuery<{ pid: number }>(
      db,
      'select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))',
      [pid],
    )
    if (waiters.length) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected the real dependency write to wait for the target card lock')
}

describe('atomic dependency graph decisions', () => {
  it('allows only one of two concurrent opposing edges', async () => {
    const f = await fixture(2)
    const results = await Promise.all([
      post(f.session, `/cards/${f.ids[0]}/dependencies`, { blockedByCardId: f.ids[1] }),
      post(f.session, `/cards/${f.ids[1]}/dependencies`, { blockedByCardId: f.ids[0] }),
    ])
    expect(results.map((response) => response.status).sort()).toEqual([201, 422])
    expect(await edges(f.department.id)).toHaveLength(1)
    const refused = results.find((response) => response.status === 422)!
    expect(await refused.json()).toMatchObject({
      errors: [{ path: 'blockedByCardId', code: 'cycle' }],
    })
  })
  it('prevents a cycle formed by three concurrent edges', async () => {
    const f = await fixture(3)
    const results = await Promise.all(
      f.ids.map((id, index) =>
        post(f.session, `/cards/${id}/dependencies`, { blockedByCardId: f.ids[(index + 1) % 3] }),
      ),
    )
    expect(results.map((response) => response.status).sort()).toEqual([201, 201, 422])
    expect(await edges(f.department.id)).toHaveLength(2)
  })
  it('rereads a concurrently deleted target after waiting for its actual row lock', async () => {
    const f = await fixture(2)
    const removal = new Client({ connectionString: db.superuserUrl })
    await removal.connect()
    await removal.query('begin')
    try {
      await removal.query('update app.cards set deleted_at=now() where id=$1', [f.ids[1]])
      const adding = post(f.session, `/cards/${f.ids[0]}/dependencies`, {
        blockedByCardId: f.ids[1],
      })
      await blockedBy(removal)
      await removal.query('commit')
      expect((await adding).status).toBe(404)
      expect(await edges(f.department.id)).toEqual([])
    } finally {
      await removal.query('rollback')
      await removal.end()
    }
  })
})

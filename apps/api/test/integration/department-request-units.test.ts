import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
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
let admin: Session
let head: Session
let requesterId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const administrator = await seedBareUser(db, { instanceRole: 'super_admin' })
  const requester = await seedBareUser(db)
  requesterId = requester.id
  admin = await loginAs(server.baseUrl, administrator.login)
  head = await loginAs(server.baseUrl, requester.login)
})

afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function request(session: Session, path: string, method = 'GET', body?: unknown) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers: session.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function submit(units: { name: string; colour?: string }[]) {
  const created = await request(head, '/departments/requests', 'POST', {
    name: `Synthetic request ${randomUUID()}`,
    units,
    locale: 'en',
  })
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as { id: string }
  const approved = await request(admin, `/departments/requests/${id}/approve`, 'POST', {})
  expect(approved.status).toBe(200)
  const { departmentId } = (await approved.json()) as { departmentId: string }
  return { id, departmentId }
}

it('approval preserves submitted units, order and categorical colours exactly once with the head membership', async () => {
  const { id, departmentId } = await submit([
    { name: 'Reporting office', colour: '#2563eb' },
    { name: 'Delivery office', colour: '#dc2626' },
    { name: 'Uncoloured office' },
  ])
  const overview = await request(head, `/departments/${departmentId}/units`)
  expect(overview.status).toBe(200)
  expect(await overview.json()).toMatchObject({
    myRole: 'head',
    units: [
      { name: 'Reporting office', colour: 6, sort: 0, parentUnitId: null },
      { name: 'Delivery office', colour: 1, sort: 1, parentUnitId: null },
      { name: 'Uncoloured office', colour: null, sort: 2, parentUnitId: null },
    ],
  })
  const rows = await superuserQuery<{ id: string; path: string; name: string }>(
    db,
    'select id, path, name from app.units where department_id=$1 order by sort',
    [departmentId],
  )
  expect(rows.map((unit) => unit.name)).toEqual([
    'Reporting office',
    'Delivery office',
    'Uncoloured office',
  ])
  for (const unit of rows) expect(unit.path).toBe(`/${unit.id}/`)
  expect(
    await superuserQuery(
      db,
      'select role from app.memberships where department_id=$1 and user_id=$2',
      [departmentId, requesterId],
    ),
  ).toMatchObject([{ role: 'head' }])
  const repeated = await request(admin, `/departments/requests/${id}/approve`, 'POST', {})
  expect(repeated.status).toBe(409)
  expect(
    await superuserQuery(db, 'select id from app.units where department_id=$1', [departmentId]),
  ).toHaveLength(3)
  expect(
    await superuserQuery(
      db,
      "select subject_id from audit.events where department_id=$1 and action='structure.unit_created'",
      [departmentId],
    ),
  ).toHaveLength(3)
  expect(
    await superuserQuery(
      db,
      "select id from app.outbox_events where department_id=$1 and type='structure.unit.created'",
      [departmentId],
    ),
  ).toHaveLength(3)
})

it('approves an existing valid request with no units and still creates its head membership', async () => {
  const { departmentId } = await submit([])
  const overview = await request(head, `/departments/${departmentId}/units`)
  expect(overview.status).toBe(200)
  expect(await overview.json()).toMatchObject({ myRole: 'head', units: [] })
})

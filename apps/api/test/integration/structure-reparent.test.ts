import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
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

type Unit = { id: string; parentUnitId: string | null; path: string; name: string }

let db: Db
let server: Server
let session: Session
let departmentId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Synthetic structure moves',
    slug: `structure-${randomUUID()}`,
  })
  departmentId = department.id
  const head = await seedMember(db, departmentId, { role: 'head' })
  session = await loginAs(server.baseUrl, head.login)
}, 180_000)

afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${server.baseUrl}/api/v1/departments/${departmentId}${path}`, {
    method,
    headers: session.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function create(name: string, parentUnitId: string | null = null): Promise<Unit> {
  const response = await request('/units', 'POST', { name, parentUnitId })
  expect(response.status).toBe(201)
  return response.json() as Promise<Unit>
}

it('moves the entire subtree between parents and back to the root without changing unrelated paths', async () => {
  const first = await create('First office')
  const second = await create('Second office')
  const child = await create('Moving team', first.id)
  const grandchild = await create('Nested team', child.id)
  const sibling = await create('Untouched team', first.id)

  const response = await request(`/units/${child.id}`, 'PATCH', { parentUnitId: second.id })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    id: child.id,
    parentUnitId: second.id,
    path: `/${second.id}/${child.id}/`,
  })
  const read = await superuserQuery<{ id: string; parent_unit_id: string | null; path: string }>(
    db,
    'select id, parent_unit_id, path from app.units where department_id = $1 order by id',
    [departmentId],
  )
  expect(read.find((unit) => unit.id === grandchild.id)).toMatchObject({
    parent_unit_id: child.id,
    path: `/${second.id}/${child.id}/${grandchild.id}/`,
  })
  expect(read.find((unit) => unit.id === sibling.id)?.path).toBe(sibling.path)
  expect(read.find((unit) => unit.id === first.id)?.path).toBe(first.path)

  const root = await request(`/units/${child.id}`, 'PATCH', { parentUnitId: null })
  expect(root.status).toBe(200)
  const overview = (await (await request('/units')).json()) as { units: Unit[] }
  expect(overview.units.find((unit) => unit.id === child.id)).toMatchObject({
    parentUnitId: null,
    path: `/${child.id}/`,
  })
  expect(overview.units.find((unit) => unit.id === grandchild.id)?.path).toBe(
    `/${child.id}/${grandchild.id}/`,
  )
})

it('rejects nesting a parent beneath itself or its descendant and preserves both paths', async () => {
  const parent = await create('Cycle guard')
  const child = await create('Cycle child', parent.id)
  expect((await request(`/units/${parent.id}`, 'PATCH', { parentUnitId: parent.id })).status).toBe(
    409,
  )
  expect((await request(`/units/${parent.id}`, 'PATCH', { parentUnitId: child.id })).status).toBe(
    409,
  )
  const overview = (await (await request('/units')).json()) as { units: Unit[] }
  expect(overview.units.find((unit) => unit.id === parent.id)?.path).toBe(parent.path)
  expect(overview.units.find((unit) => unit.id === child.id)?.path).toBe(child.path)
})

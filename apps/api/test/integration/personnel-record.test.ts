import { personnelDataSchema, personnelTemplate } from '@devon/contracts'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  type Db,
  type Server,
  type Session,
} from './harness.js'
let db: Db,
  server: Server,
  owner: Session,
  head: Session,
  peer: Session,
  foreignHead: Session,
  ownerId: string,
  departmentId: string
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Personnel privacy',
    slug: 'personnel-' + randomUUID(),
  })
  const foreign = await seedDepartment(db, {
    name: 'Other department',
    slug: 'foreign-' + randomUUID(),
  })
  departmentId = department.id
  const members = await Promise.all([
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, department.id, { role: 'head' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, foreign.id, { role: 'head' }),
  ])
  ownerId = members[0]!.id
  ;[owner, head, peer, foreignHead] = (await Promise.all(
    members.map((member) => loginAs(server.baseUrl, member.login)),
  )) as [Session, Session, Session, Session]
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(actor: Session, suffix = '', data?: unknown) {
  const headers = { ...actor.headers }
  if (!data) delete headers['content-type']
  return fetch(server.baseUrl + '/api/v1/accounts/personnel-record' + suffix, {
    method: data ? 'PUT' : 'GET',
    headers,
    ...(data ? { body: JSON.stringify(data) } : {}),
  })
}
const valid = () =>
  personnelDataSchema.parse({
    fio: 'Karimov Sardor Akmalovich',
    birthDate: '1995-05-12',
    birthPlace: 'Toshkent shahri',
    nationality: 'oʻzbek',
    eduLevel: 'ўрта',
    work: [
      {
        from: '2020',
        to: '',
        current: true,
        since: '2020-01-01',
        months: '',
        text: 'Raqamli texnologiyalar markazi bosh mutaxassisi',
      },
    ],
    relatives: [
      {
        rel: 'Отаси',
        name: 'Karimov Akmal Salimovich',
        year: '1965',
        place: 'Toshkent shahri',
        status: 'work',
        job: 'Maktab oʻqituvchisi',
        prevJob: '',
        deathYear: '',
        address: 'Toshkent shahri, Bogʻ koʻchasi, 12-uy',
      },
    ],
  })
it('keeps private records owner/head-only, preserves revisions and never publishes them in the directory', async () => {
  const data = valid()
  expect(personnelTemplate.validate(data).errors).toEqual([])
  expect((await request(owner)).status).toBe(200)
  const saved = await request(owner, '', { version: 0, data })
  expect(saved.status, await saved.clone().text()).toBe(200)
  expect(((await saved.json()) as { version: number }).version).toBe(1)
  expect((await request(owner, '', { version: 0, data })).status).toBe(409)
  const forOwner = '?ownerUserId=' + ownerId
  const read = await request(head, forOwner)
  expect(read.status).toBe(200)
  expect(
    ((await read.json()) as { data: ReturnType<typeof valid> }).data.relatives[0]!.address,
  ).toBe(data.relatives[0]!.address)
  expect((await request(peer, forOwner)).status).toBe(404)
  expect((await request(foreignHead, forOwner)).status).toBe(404)
  expect((await request(head, '', { version: 1, data })).status).toBe(409)
  expect((await request(owner, '', { version: 1, data: { ...data, fio: '' } })).status).toBe(422)
  const directory = await fetch(server.baseUrl + `/api/v1/departments/${departmentId}/roster`, {
    headers: head.headers,
  })
  expect(directory.status).toBe(200)
  expect(await directory.text()).not.toContain(data.relatives[0]!.address)
  expect((await request(owner, '', { version: 1, data: { ...data, party: 'йўқ' } })).status).toBe(
    200,
  )
})

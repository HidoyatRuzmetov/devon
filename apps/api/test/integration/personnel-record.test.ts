import { personnelDataSchema, personnelTemplate } from '@devon/contracts'
import { MockProvider, type ChatCompletionResult } from '@devon/ai'
import { __setProviderForTests } from '../../src/modules/ai/service.js'
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
  __setProviderForTests(null)
  if (db && server) await stopHarness({ db, server })
})

it('prepares exports only for owner/head, preserves AI-identified names and never stores private prompts', async () => {
  await superuserQuery(
    db,
    `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags) values($1,1000000,'{"semantic_ask":true}') on conflict(department_id) do update set flags=excluded.flags`,
    [departmentId],
  )
  const response = (names: string[]): ChatCompletionResult => ({
    content: null,
    reasoningContent: null,
    finishReason: 'tool_calls',
    usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    toolCalls: [
      {
        id: randomUUID(),
        name: 'personnel_verbatim_names',
        argumentsJson: JSON.stringify({ names }),
      },
    ],
  })
  const model = new MockProvider({
    script: [response(['Invented brand']), response(['Cola', 'PhD'])],
  })
  __setProviderForTests(model)
  const data = valid()
  data.work[0]!.text = 'Cola kompaniyasi bosh mutaxassisi'
  data.degree = 'texnika fanlari bo‘yicha falsafa doktori (PhD)'
  data.photo = 'data:image/jpeg;base64,/9j/2Q=='
  const payload = { ownerUserId: ownerId, data, script: 'cyrillic' }
  const prepare = (actor: Session, body = payload, headers = actor.headers) =>
    fetch(server.baseUrl + '/api/v1/accounts/personnel-record/prepare-export', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  expect((await prepare(peer)).status).toBe(404)
  expect((await prepare(foreignHead)).status).toBe(404)
  const noCsrf = { ...owner.headers }
  delete noCsrf['x-csrf-token']
  expect((await prepare(owner, payload, noCsrf)).status).toBe(403)
  expect(model.calls).toHaveLength(0)
  const prepared = await prepare(owner)
  expect(prepared.status, await prepared.clone().text()).toBe(200)
  expect(prepared.headers.get('cache-control')).toBe('no-store')
  const result = (await prepared.json()) as { data: ReturnType<typeof valid> }
  expect(result.data.work[0]!.text).toBe('Cola компанияси бош мутахассиси')
  expect(result.data.degree).toContain('PhD')
  expect(result.data.photo).toBe(data.photo)
  expect(result.data.protectedNames).toEqual(['Cola', 'PhD'])
  expect(model.calls).toHaveLength(2) // Invented substrings are rejected and retried.
  const sent = JSON.stringify(model.calls[0]!.messages)
  expect(sent).not.toContain(data.photo)
  expect(sent).not.toContain(data.birthDate)
  expect(sent).not.toContain(data.work[0]!.since)
  const before = await (await request(owner)).text()
  expect((await prepare(head)).status).toBe(200)
  expect(await (await request(owner)).text()).toBe(before)
  const traces = await superuserQuery(db, 'select * from app.ai_traces where department_id=$1', [
    departmentId,
  ])
  expect(traces).toHaveLength(2)
  expect(JSON.stringify(traces)).not.toContain(data.relatives[0]!.address)
  expect(JSON.stringify(traces)).not.toContain(data.fio)
  await superuserQuery(
    db,
    `update app.ai_department_settings set flags='{"semantic_ask":false}' where department_id=$1`,
    [departmentId],
  )
  expect((await prepare(head)).status).toBe(403)
  expect(model.calls).toHaveLength(3)
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

it('imports source-supported fields into a response only, requires CSRF and leaves saved records unchanged', async () => {
  await superuserQuery(
    db,
    `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags) values($1,1000000,'{"semantic_ask":true}') on conflict(department_id) do update set flags=excluded.flags`,
    [departmentId],
  )
  const data = {
    fio: 'Karimov Sardor',
    party: '',
    degree: '',
    title: '',
    languages: '',
    awards: '',
    deputy: '',
  }
  const model = new MockProvider({
    script: [
      {
        content: null,
        reasoningContent: null,
        finishReason: 'tool_calls',
        usage: { promptTokens: 50, completionTokens: 80, totalTokens: 130 },
        toolCalls: [
          {
            id: randomUUID(),
            name: 'import_personnel_record',
            argumentsJson: JSON.stringify({
              data,
              evidence: [{ path: 'fio', quote: data.fio }],
              warnings: ['Birth date was not provided.'],
            }),
          },
        ],
      },
    ],
  })
  __setProviderForTests(model)
  const before = await (await request(owner)).json()
  const payload = { name: 'record.txt', content: Buffer.from('Karimov Sardor').toString('base64') }
  const send = (headers = owner.headers, body: unknown = payload) =>
    fetch(server.baseUrl + '/api/v1/accounts/personnel-record/import', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  const noCsrf = { ...owner.headers }
  delete noCsrf['x-csrf-token']
  expect((await send(noCsrf)).status).toBe(403)
  expect((await send(owner.headers, { ...payload, ownerUserId: ownerId })).status).toBe(422)
  const imported = await send()
  expect(imported.status, await imported.clone().text()).toBe(200)
  expect(imported.headers.get('cache-control')).toBe('no-store')
  expect(await imported.json()).toMatchObject({
    data: { fio: 'Karimov Sardor', photo: null, birthDate: '' },
    warnings: ['Birth date was not provided.'],
  })
  expect(await (await request(owner)).json()).toEqual(before)
  expect(model.calls).toHaveLength(1)
  __setProviderForTests(null)
})

it('exposes independent resume and personnel revision dates only to permitted viewers', async () => {
  const roster = async (actor: Session) => {
    const response = await fetch(
      server.baseUrl + '/api/v1/departments/' + departmentId + '/roster',
      { headers: actor.headers },
    )
    expect(response.status).toBe(200)
    const rows = (await response.json()) as {
      userId: string
      resumeUpdatedAt: string | null
      personnelUpdatedAt: string | null
    }[]
    return rows.find((row) => row.userId === ownerId)!
  }
  const before = await roster(head)
  expect(before.personnelUpdatedAt).toBeTruthy()
  expect((await roster(peer)).personnelUpdatedAt).toBeNull()
  await superuserQuery(
    db,
    "update app.users set professional_profile='{}'::jsonb, title='Revision date test' where id=$1",
    [ownerId],
  )
  const updated = await roster(head)
  expect(updated.resumeUpdatedAt).toBeTruthy()
  expect(updated.personnelUpdatedAt).toBe(before.personnelUpdatedAt)
  await superuserQuery(db, "update app.users set locale='en' where id=$1", [ownerId])
  expect((await roster(head)).resumeUpdatedAt).toBe(updated.resumeUpdatedAt)
})

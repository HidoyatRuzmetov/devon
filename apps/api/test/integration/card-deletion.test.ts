import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loginAs,
  seedBareUser,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let owner: Session
let colleague: Session
let outsider: Session
let head: Session
let admin: Session

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const dept = await seedDepartment(db, { name: 'Deletion tests', slug: `delete-${randomUUID()}` })
  const other = await seedDepartment(db, { name: 'Other', slug: `other-${randomUUID()}` })
  const users = await Promise.all([
    seedMember(db, dept.id, { role: 'member' }),
    seedMember(db, dept.id, { role: 'member' }),
    seedMember(db, other.id, { role: 'member' }),
    seedMember(db, dept.id, { role: 'head' }),
    seedBareUser(db, { instanceRole: 'super_admin' }),
  ])
  ;[owner, colleague, outsider, head, admin] = (await Promise.all(
    users.map((u) => loginAs(server.baseUrl, u.login)),
  )) as [Session, Session, Session, Session, Session]
})

afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})

function request(path: string, session: Session, method = 'GET', body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function createCard(session = owner) {
  const response = await request('/cards', session, 'POST', { title: 'Retained deletion evidence' })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string; version: number }
}

async function sql<T>(query: string, values: unknown[]) {
  const client = new Client({ connectionString: db.superuserUrl })
  await client.connect()
  try {
    return (await client.query(query, values)).rows as T[]
  } finally {
    await client.end()
  }
}

describe('card deletion and audit retention', () => {
  it('denies unrelated members, other departments, missing CSRF and anonymous callers', async () => {
    const card = await createCard()
    expect((await request(`/cards/${card.id}`, colleague, 'DELETE')).status).toBe(403)
    expect((await request(`/cards/${card.id}`, outsider, 'DELETE')).status).toBe(404)
    const noCsrf = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    })
    expect(noCsrf.status).toBe(403)
    expect(
      (await fetch(`${server.baseUrl}/api/v1/cards/${card.id}`, { method: 'DELETE' })).status,
    ).toBe(401)
    expect((await request(`/cards/${card.id}`, owner)).status).toBe(200)
  })

  it('hides deleted cards, retains their children and audit snapshot, and allows only the deleting actor to undo', async () => {
    const card = await createCard()
    expect(
      (await request(`/cards/${card.id}/comments`, owner, 'POST', { text: 'Keep this history' }))
        .status,
    ).toBe(201)
    expect((await request(`/cards/${card.id}`, owner, 'DELETE')).status).toBe(204)
    const hidden = await Promise.all(
      [owner, colleague, head].map((session) => request(`/cards/${card.id}`, session)),
    )
    expect(hidden.map((r) => r.status)).toEqual([404, 404, 404])
    expect((await request(`/cards/${card.id}/activity`, owner)).status).toBe(404)
    expect((await request(`/cards/${card.id}/reminders`, owner)).status).toBe(404)
    expect((await request(`/cards/${card.id}/time-logs`, owner)).status).toBe(404)
    expect((await request(`/cards/${card.id}/dependencies`, owner)).status).toBe(404)
    expect(
      (await request(`/cards/${card.id}/comments`, owner, 'POST', { text: 'Must not write' }))
        .status,
    ).toBe(404)
    const listed = (await (await request('/cards', owner)).json()) as { items: { id: string }[] }
    expect(listed.items.some((item) => item.id === card.id)).toBe(false)
    const retained = await sql<{ title: string; deleted_at: Date; children: string }>(
      'select title, deleted_at, (select count(*) from app.card_comments where card_id = c.id) as children from app.cards c where id = $1',
      [card.id],
    )
    expect(retained[0]?.title).toBe('Retained deletion evidence')
    expect(retained[0]?.deleted_at).toBeTruthy()
    expect(Number(retained[0]?.children)).toBe(1)
    const audit = await sql<{ before: { title: string } }>(
      "select before from audit.events where subject_id = $1 and action = 'work.card_deleted'",
      [card.id],
    )
    expect(audit[0]?.before.title).toBe('Retained deletion evidence')
    const events = (await (
      await request('/admin/audit/events?action=work.card_deleted', admin)
    ).json()) as { events: { subjectId: string; subjectTitle: string }[] }
    expect(events.events.find((event) => event.subjectId === card.id)?.subjectTitle).toBe(
      'Retained deletion evidence',
    )
    expect((await request('/admin/audit/events', owner)).status).toBe(403)
    expect((await request(`/cards/${card.id}/undo-delete`, colleague, 'POST', {})).status).toBe(404)
    expect((await request(`/cards/${card.id}/undo-delete`, outsider, 'POST', {})).status).toBe(404)
    expect((await request(`/cards/${card.id}/undo-delete`, owner, 'POST', {})).status).toBe(204)
    expect((await request(`/cards/${card.id}`, owner)).status).toBe(200)
  })

  it('lets a head delete department cards but expires the undo window', async () => {
    const card = await createCard()
    expect((await request(`/cards/${card.id}`, head, 'DELETE')).status).toBe(204)
    expect((await request(`/cards/${card.id}/undo-delete`, owner, 'POST', {})).status).toBe(404)
    await sql("update app.cards set deleted_at = now() - interval '1 minute' where id = $1", [
      card.id,
    ])
    expect((await request(`/cards/${card.id}/undo-delete`, head, 'POST', {})).status).toBe(404)
    expect((await request(`/cards/${card.id}/restore`, head, 'POST', {})).status).toBe(404)
  })

  it('retains automation run history without exposing a deleted card title or link', async () => {
    const card = await createCard()
    const ruleId = randomUUID()
    const runId = randomUUID()
    await sql(
      `insert into app.automation_rules (id, department_id, name, trigger, created_by_user_id)
       select $1, department_id, 'Deletion regression', 'card_created', created_by_user_id
       from app.cards where id = $2`,
      [ruleId, card.id],
    )
    await sql(
      `insert into app.automation_runs (id, department_id, rule_id, card_id, status)
       select $1, department_id, $2, id, 'skipped' from app.cards where id = $3`,
      [runId, ruleId, card.id],
    )
    const readRun = async () => {
      const response = await request(`/automations/runs?ruleId=${ruleId}`, head)
      expect(response.status).toBe(200)
      return (await response.json()) as {
        items: { id: string; cardId: string | null; cardTitle: string | null }[]
      }
    }
    expect((await readRun()).items[0]?.cardTitle).toBe('Retained deletion evidence')
    expect((await request(`/cards/${card.id}`, owner, 'DELETE')).status).toBe(204)
    expect((await readRun()).items[0]).toMatchObject({ id: runId, cardId: null, cardTitle: null })
    expect((await request(`/cards/${card.id}/undo-delete`, owner, 'POST', {})).status).toBe(204)
    expect((await readRun()).items[0]?.cardId).toBe(card.id)
  })

  it('cannot mutate a colleague’s checklist by supplying an owned card in the URL', async () => {
    const [mine, theirs] = await Promise.all([createCard(), createCard(colleague)])
    const response = await request(`/cards/${theirs.id}/checklist`, colleague, 'POST', {
      text: 'Protected item',
    })
    expect(response.status).toBe(201)
    const item = (await response.json()) as { id: string }
    expect(
      (await request(`/cards/${mine.id}/checklist/${item.id}`, owner, 'PATCH', { done: true }))
        .status,
    ).toBe(404)
    expect((await request(`/cards/${mine.id}/checklist/${item.id}`, owner, 'DELETE')).status).toBe(
      404,
    )
    const detail = (await (await request(`/cards/${theirs.id}`, colleague)).json()) as {
      checklist: { id: string; doneAt: string | null }[]
    }
    expect(detail.checklist).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: item.id, doneAt: null })]),
    )
  })
})

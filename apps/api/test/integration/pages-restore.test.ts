import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { restorePage } from '../../src/modules/pages/repo.js'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  loginAs,
  superuserQuery,
  type Db,
  type Server,
  type SeededUser,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let departmentId: string
let owner: SeededUser
let head: SeededUser
let colleague: SeededUser
let ownerSession: Session
let headSession: Session
let colleagueSession: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Page restore QA', slug: `pages-${randomUUID()}` })
  ).id
  owner = await seedMember(db, departmentId, { role: 'member' })
  head = await seedMember(db, departmentId, { role: 'head' })
  colleague = await seedMember(db, departmentId, { role: 'member' })
  ownerSession = await loginAs(server.baseUrl, owner.login)
  headSession = await loginAs(server.baseUrl, head.login)
  colleagueSession = await loginAs(server.baseUrl, colleague.login)
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(session: Session, path: string, method = 'GET', data?: unknown) {
  const headers = { ...session.headers }
  if (data === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/pages${path}`, {
    method,
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
}
async function deletedPage() {
  const created = await request(ownerSession, '', 'POST', {
    kind: 'note',
    title: `Restore QA ${randomUUID()}`,
  })
  expect(created.status).toBe(201)
  const page = (await created.json()) as { id: string; version: number }
  expect((await request(ownerSession, `/${page.id}`, 'DELETE')).status).toBe(204)
  return page
}
async function state(id: string) {
  return (
    await superuserQuery(
      db,
      'select deleted_at is not null as deleted, version from app.pages where id=$1',
      [id],
    )
  )[0]
}
describe('knowledge-page restore has an actual owner or current head', () => {
  it.each(['owner', 'head'] as const)(
    'restores for the %s with an atomic version, audit and outbox receipt',
    async (role) => {
      const page = await deletedPage()
      const before = await state(page.id)
      expect(
        (
          await request(
            role === 'owner' ? ownerSession : headSession,
            `/${page.id}/restore`,
            'POST',
            {},
          )
        ).status,
      ).toBe(204)
      expect(await state(page.id)).toEqual({
        deleted: false,
        version: Number(before?.['version']) + 1,
      })
      const receipts = await superuserQuery(
        db,
        `select (select count(*)::int from audit.events where subject_id=$1::text and action='pages.page.restored') as audits, (select count(*)::int from app.outbox_events where type='pages.page.restored' and payload->>'pageId'=$1::text) as events`,
        [page.id],
      )
      expect(receipts[0]).toEqual({ audits: 1, events: 1 })
    },
  )
  it('rejects an editing colleague without changing the deleted row', async () => {
    const page = await deletedPage()
    const before = await state(page.id)
    expect((await request(colleagueSession, `/${page.id}/restore`, 'POST', {})).status).toBe(403)
    expect(await state(page.id)).toEqual(before)
    expect((await request(colleagueSession, `/${page.id}`)).status).toBe(404)
  })
  it('bounds the undo window and unknown identifiers with a conflict', async () => {
    const page = await deletedPage()
    await superuserQuery(
      db,
      "update app.pages set deleted_at=now()-interval '11 minutes' where id=$1",
      [page.id],
    )
    const before = await state(page.id)
    expect((await request(ownerSession, `/${page.id}/restore`, 'POST', {})).status).toBe(409)
    expect((await request(ownerSession, `/${randomUUID()}/restore`, 'POST', {})).status).toBe(409)
    expect(await state(page.id)).toEqual(before)
  })
  it('does not restore another department even for its own head', async () => {
    const other = await seedDepartment(db, {
      name: 'Other page restore QA',
      slug: `pages-other-${randomUUID()}`,
    })
    const outsider = await seedMember(db, other.id, { role: 'head' })
    const session = await loginAs(server.baseUrl, outsider.login)
    const page = await deletedPage()
    const before = await state(page.id)
    expect((await request(session, `/${page.id}/restore`, 'POST', {})).status).toBe(409)
    expect(await state(page.id)).toEqual(before)
  })
  it('rechecks a removed owner inside the transaction rather than trusting an earlier permission', async () => {
    const removed = await seedMember(db, departmentId, { role: 'member' })
    const session = await loginAs(server.baseUrl, removed.login)
    const response = await request(session, '', 'POST', { title: `Removed owner ${randomUUID()}` })
    expect(response.status).toBe(201)
    const page = (await response.json()) as { id: string }
    expect((await request(session, `/${page.id}`, 'DELETE')).status).toBe(204)
    await superuserQuery(
      db,
      "update app.memberships set status='removed', version=version+1 where user_id=$1 and department_id=$2",
      [removed.id, departmentId],
    )
    expect(
      await restorePage(departmentId, page.id, {
        userId: removed.id,
        actorRole: 'member',
        requestId: randomUUID(),
        actingForUserId: null,
        ip: '',
        userAgent: 'pages-restore-qa',
      }),
    ).toBe('forbidden')
    expect((await state(page.id))?.['deleted']).toBe(true)
  })
  it('accepts exactly one concurrent restore and one audit/outbox receipt', async () => {
    const page = await deletedPage()
    const results = await Promise.all([
      request(ownerSession, `/${page.id}/restore`, 'POST', {}),
      request(headSession, `/${page.id}/restore`, 'POST', {}),
    ])
    expect(results.map((response) => response.status).sort()).toEqual([204, 409])
    const receipts = await superuserQuery(
      db,
      `select (select count(*)::int from audit.events where subject_id=$1::text and action='pages.page.restored') as audits, (select count(*)::int from app.outbox_events where type='pages.page.restored' and payload->>'pageId'=$1::text) as events`,
      [page.id],
    )
    expect(receipts[0]).toEqual({ audits: 1, events: 1 })
  })
})

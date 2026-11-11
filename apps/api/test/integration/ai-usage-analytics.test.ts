import { randomUUID } from 'node:crypto'
import {
  adminAiUsageSchema,
  adminAiUsageHoursSchema,
  departmentAiUsageSummarySchema,
} from '@devon/contracts'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  loginAs,
  seedBareUser,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db, server: Server, admin: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const owner = await seedBareUser(db, { instanceRole: 'super_admin' })
  admin = await loginAs(server.baseUrl, owner.login)
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
function request(path: string, session = admin) {
  return fetch(`${server.baseUrl}/api/v1/admin/${path}`, { headers: { cookie: session.cookie } })
}

it('aggregates actual usage at Tashkent midnight, restricts department totals to its head, and retains historical billing', async () => {
  const active = await seedDepartment(db, { name: 'Current usage fixture', slug: randomUUID() })
  const historical = await seedDepartment(db, {
    name: 'Historical usage fixture',
    slug: randomUUID(),
  })
  const empty = await seedDepartment(db, { name: 'No usage fixture', slug: randomUUID() })
  const head = await seedMember(db, active.id, { role: 'head' })
  const member = await seedMember(db, active.id, { role: 'member' })
  const emptyHead = await seedMember(db, empty.id, { role: 'head' })
  const historicalHead = await seedMember(db, historical.id, { role: 'head' })
  const [headLogin, memberLogin, emptyLogin] = await Promise.all([
    loginAs(server.baseUrl, head.login),
    loginAs(server.baseUrl, member.login),
    loginAs(server.baseUrl, emptyHead.login),
  ])
  await superuserQuery(
    db,
    `insert into app.ai_traces(department_id,user_id,feature,model,status,total_tokens,cost_uzs,created_at) values
      ($1,$2,'semantic_ask','private-model','ok',4,1,'2001-01-31T18:59:59.999999Z'),
      ($1,$3,'semantic_ask','private-model','ok',20,5,'2001-01-31T19:00:00Z'),
      ($1,$2,'semantic_ask','private-model','blocked_budget',0,0,'2001-01-31T19:10:00Z'),
      ($1,$3,'semantic_ask','private-model','ok',60,15,'2001-02-01T18:59:59Z'),
      ($1,$3,'semantic_ask','private-model','ok',6,2,'2001-02-28T19:00:00Z'),
      ($4,$5,'semantic_ask','private-model','ok',900,200,'2001-01-31T19:11:00Z')`,
    [active.id, head.id, member.id, historical.id, historicalHead.id],
  )
  await superuserQuery(
    db,
    "update app.departments set status='archived',deleted_at=now() where id=$1",
    [historical.id],
  )
  const daily = await request('analytics/ai-usage')
  expect(daily.status).toBe(200)
  const encoded = await daily.text()
  expect(encoded).not.toContain('private-model')
  expect(encoded).not.toContain(head.id)
  const history = adminAiUsageSchema.parse(JSON.parse(encoded))
  expect(history.departments).toEqual(
    expect.arrayContaining([
      { id: active.id, name: 'Current usage fixture' },
      { id: historical.id, name: 'Historical usage fixture' },
      { id: empty.id, name: 'No usage fixture' },
    ]),
  )
  expect(history.days.filter((row) => row.departmentId === active.id)).toEqual([
    { day: '2001-01-31', departmentId: active.id, runs: 1, tokens: 4, costUzs: 1 },
    { day: '2001-02-01', departmentId: active.id, runs: 3, tokens: 80, costUzs: 20 },
    { day: '2001-03-01', departmentId: active.id, runs: 1, tokens: 6, costUzs: 2 },
  ])
  const hours = adminAiUsageHoursSchema.parse(
    await (await request('analytics/ai-usage/hours?day=2001-02-01')).json(),
  )
  expect(hours.hours.filter((row) => row.departmentId === active.id)).toEqual([
    { hour: 0, departmentId: active.id, runs: 2, tokens: 20, costUzs: 5 },
    { hour: 23, departmentId: active.id, runs: 1, tokens: 60, costUzs: 15 },
  ])
  expect(hours.hours).toContainEqual({
    hour: 0,
    departmentId: historical.id,
    runs: 1,
    tokens: 900,
    costUzs: 200,
  })
  const summary = (session: Session, query = '') =>
    fetch(`${server.baseUrl}/api/v1/ai/usage/summary${query}`, {
      headers: { cookie: session.cookie },
    })
  expect(
    departmentAiUsageSummarySchema.parse(await (await summary(headLogin, '?month=2001-02')).json()),
  ).toEqual({
    month: '2001-02',
    today: history.today,
    firstMonth: '2001-01',
    monthly: { tokens: 80, costUzs: 20, runs: 3 },
    allTime: { tokens: 90, costUzs: 23, runs: 5 },
  })
  expect(departmentAiUsageSummarySchema.parse(await (await summary(emptyLogin)).json())).toEqual({
    month: history.today.slice(0, 7),
    today: history.today,
    firstMonth: null,
    monthly: { tokens: 0, costUzs: 0, runs: 0 },
    allTime: { tokens: 0, costUzs: 0, runs: 0 },
  })
  expect((await summary(memberLogin)).status).toBe(403)
  expect((await request('analytics/ai-usage', headLogin)).status).toBe(403)
  expect((await request('analytics/ai-usage/hours?day=2001-02-01', memberLogin)).status).toBe(403)
  expect((await request('analytics/ai-usage/hours?day=2001-02-29')).status).toBe(422)
  expect((await summary(headLogin, '?month=2001-13')).status).toBe(422)
})

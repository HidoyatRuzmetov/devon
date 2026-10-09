// Real migrated local Postgres and Fastify. No integration keys or external service calls.
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  automationRuleListSchema,
  automationRunListSchema,
} from '../../src/modules/automations/schemas.js'
import { decodeRunCursor } from '../../src/modules/automations/cursor.js'
import { areActionTargetsEligible } from '../../src/modules/automations/repo.js'
import { systemContext } from '../../src/modules/automations/context.js'
import { evaluateTrigger } from '../../src/modules/automations/engine.js'
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

let db: Db
let server: Server
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

async function fixture(withMember = false) {
  const department = await seedDepartment(db, {
    name: 'Local automation QA',
    slug: `rules-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const member = withMember ? await seedMember(db, department.id, { role: 'member' }) : null
  return {
    department,
    head,
    headSession: await loginAs(server.baseUrl, head.login),
    memberSession: member ? await loginAs(server.baseUrl, member.login) : null,
  }
}
function request(session: Session, path = '', method = 'GET', body?: unknown) {
  return fetch(`${server.baseUrl}/api/v1/automations${path}`, {
    method,
    headers:
      body === undefined
        ? { cookie: session.cookie, 'x-csrf-token': session.csrf }
        : session.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const ruleBody = (enabled = true) => ({
  name: `Local rule ${randomUUID()}`,
  trigger: 'card_created',
  triggerConfig: {},
  actions: [{ kind: 'notify_head' }],
  enabled,
})
async function create(session: Session, enabled = true) {
  const response = await request(session, '', 'POST', ruleBody(enabled))
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}
async function seedRules(departmentId: string, userId: string, count: number, enabled: boolean) {
  return superuserQuery<{ id: string }>(
    db,
    `insert into app.automation_rules
    (id,department_id,name,trigger,trigger_config,actions,enabled,created_by_user_id)
    select gen_random_uuid(),$1,'Seed rule '||n,'card_created','{}','[{"kind":"notify_head"}]',$2,$3
    from generate_series(1,$4::int) n returning id`,
    [departmentId, enabled, userId, count],
  )
}
async function sideEffects(departmentId: string) {
  const audits = await superuserQuery(
    db,
    "select action from audit.events where department_id=$1 and action like 'automations.%' order by at, id",
    [departmentId],
  )
  const events = await superuserQuery(
    db,
    "select type,payload from app.outbox_events where department_id=$1 and type like 'automations.%' order by created_at,id",
    [departmentId],
  )
  return { audits, events }
}

describe('automation persistence and authorization', () => {
  it('refuses incomplete actions and foreign or revoked targets without accepting ineffective rules', async () => {
    const f = await fixture()
    const foreign = await seedDepartment(db, {
      name: 'Foreign targets',
      slug: `targets-${randomUUID()}`,
    })
    const outsider = await seedMember(db, foreign.id, { role: 'member' })
    const recipient = await seedMember(db, f.department.id, { role: 'member' })
    for (const kind of [
      'assign',
      'notify_user',
      'add_label',
      'set_priority',
      'set_status',
      'add_checklist',
      'create_followup',
    ]) {
      expect(
        (await request(f.headSession, '', 'POST', { ...ruleBody(), actions: [{ kind }] })).status,
      ).toBe(422)
    }
    for (const actions of [
      [{ kind: 'assign', userId: outsider.id }],
      [{ kind: 'notify_user', userId: outsider.id }],
      [{ kind: 'add_label', labelId: randomUUID() }],
    ]) {
      expect((await request(f.headSession, '', 'POST', { ...ruleBody(), actions })).status).toBe(
        422,
      )
    }
    expect(await sideEffects(f.department.id)).toEqual({ audits: [], events: [] })
    const actions = [{ kind: 'assign' as const, userId: recipient.id }]
    const accepted = await request(f.headSession, '', 'POST', { ...ruleBody(false), actions })
    expect(accepted.status).toBe(201)
    const rule = (await accepted.json()) as { id: string }
    expect(
      await areActionTargetsEligible(
        systemContext(f.department.id, f.head.id),
        f.department.id,
        actions,
      ),
    ).toBe(true)
    await superuserQuery(
      db,
      'update app.memberships set deleted_at=now() where department_id=$1 and user_id=$2',
      [f.department.id, recipient.id],
    )
    const before = await sideEffects(f.department.id)
    expect(
      (await request(f.headSession, `/${rule.id}`, 'PATCH', { enabled: true, version: 1 })).status,
    ).toBe(422)
    expect(
      (
        await request(f.headSession, `/${rule.id}`, 'PATCH', {
          actions: [{ kind: 'assign' }],
          version: 1,
        })
      ).status,
    ).toBe(422)
    expect((await request(f.headSession, '/pause-all', 'POST', { enabled: true })).status).toBe(422)
    expect(
      await areActionTargetsEligible(
        systemContext(f.department.id, f.head.id),
        f.department.id,
        actions,
      ),
    ).toBe(false)
    expect(await sideEffects(f.department.id)).toEqual(before)
    // Legacy incomplete actions stay readable; only enabling/writing them is refused.
    await superuserQuery(
      db,
      'update app.automation_rules set actions=\'[ {"kind":"assign"} ]\'::jsonb where id=$1',
      [rule.id],
    )
    const legacy = automationRuleListSchema.parse(await (await request(f.headSession)).json())
    expect(legacy[0]?.actions).toEqual([{ kind: 'assign' }])
    expect(
      (await request(f.headSession, `/${rule.id}`, 'PATCH', { enabled: true, version: 1 })).status,
    ).toBe(422)
    // Simulate an old enabled rule surviving an upgrade: the actual engine must report failure,
    // rather than claim an assignment it never performed or assign a revoked member.
    await superuserQuery(
      db,
      'update app.automation_rules set enabled=true,actions=$2::jsonb where id=$1',
      [rule.id, JSON.stringify(actions)],
    )
    const created = await fetch(`${server.baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: f.headSession.headers,
      body: JSON.stringify({ title: 'Local revoked automation target' }),
    })
    expect(created.status).toBe(201)
    const card = (await created.json()) as { id: string; assigneeUserId: string | null }
    await evaluateTrigger(
      Fastify({ logger: false }).log,
      f.department.id,
      card.id,
      'card_created',
      f.head.id,
    )
    const fresh = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}`, {
      headers: f.headSession.headers,
    })
    expect(((await fresh.json()) as { assigneeUserId: string | null }).assigneeUserId).toBe(
      card.assigneeUserId,
    )
    const runs = automationRunListSchema.parse(await (await request(f.headSession, '/runs')).json())
    expect(runs.items).toHaveLength(1)
    expect(runs.items[0]).toMatchObject({
      status: 'failed',
      detail: { error: 'action_target_unavailable', actions: [] },
    })
  })
  it('caps enabled rules, permits paused copies, and pauses every enabled rule atomically', async () => {
    const f = await fixture()
    await seedRules(f.department.id, f.head.id, 25, false)
    await create(f.headSession)
    await seedRules(f.department.id, f.head.id, 24, true)
    const disabled = await create(f.headSession, false)
    const before = await sideEffects(f.department.id)
    const blocked = await request(f.headSession, '', 'POST', ruleBody())
    expect(blocked.status).toBe(422)
    expect(await blocked.json()).toMatchObject({ code: 'validation_failed' })
    const enabled = await request(f.headSession, `/${disabled.id}`, 'PATCH', {
      enabled: true,
      version: 1,
    })
    expect(enabled.status).toBe(422)
    expect(await sideEffects(f.department.id)).toEqual(before)
    const pause = await request(f.headSession, '/pause-all', 'POST', { enabled: false })
    expect(pause.status).toBe(200)
    expect(await pause.json()).toEqual({ changed: 25 })
    const persisted = automationRuleListSchema.parse(await (await request(f.headSession)).json())
    expect(persisted).toHaveLength(51)
    expect(persisted.every((rule) => !rule.enabled)).toBe(true)
    const resume = await request(f.headSession, '/pause-all', 'POST', { enabled: true })
    expect(resume.status).toBe(422)
    const after = await sideEffects(f.department.id)
    expect(after.events.map((event) => event['type'])).toEqual([
      'automations.rule.created',
      'automations.rule.created',
      'automations.rules.paused',
    ])
  })

  it('serializes concurrent claims of the last enabled slot', async () => {
    const f = await fixture()
    await seedRules(f.department.id, f.head.id, 24, true)
    const results = await Promise.all([
      request(f.headSession, '', 'POST', ruleBody()),
      request(f.headSession, '', 'POST', ruleBody()),
    ])
    expect(results.map((response) => response.status).sort()).toEqual([201, 422])
    expect(
      await superuserQuery(
        db,
        'select count(*)::int as n from app.automation_rules where department_id=$1 and enabled=true and deleted_at is null',
        [f.department.id],
      ),
    ).toEqual([{ n: 25 }])
    expect((await sideEffects(f.department.id)).events).toHaveLength(1)
  })

  it('commits one audit and pointer event per accepted change; conflicts and forbidden requests leave none', async () => {
    const f = await fixture(true)
    const rule = await create(f.headSession)
    expect(
      (await request(f.headSession, `/${rule.id}`, 'PATCH', { name: 'Edited', version: 1 })).status,
    ).toBe(204)
    expect(
      (await request(f.headSession, `/${rule.id}`, 'PATCH', { name: 'Stale', version: 1 })).status,
    ).toBe(409)
    expect((await request(f.memberSession!)).status).toBe(403)
    expect((await request(f.memberSession!, '/runs')).status).toBe(403)
    expect((await request(f.memberSession!, `/${rule.id}`, 'DELETE')).status).toBe(403)
    expect((await request(f.headSession, '/pause-all', 'POST', { enabled: false })).status).toBe(
      200,
    )
    expect((await request(f.headSession, '/pause-all', 'POST', { enabled: true })).status).toBe(200)
    expect((await request(f.headSession, `/${rule.id}`, 'DELETE')).status).toBe(204)
    const effects = await sideEffects(f.department.id)
    expect(effects.audits.map((audit) => audit['action'])).toEqual([
      'automations.rule_created',
      'automations.rule_updated',
      'automations.all_paused',
      'automations.all_resumed',
      'automations.rule_removed',
    ])
    expect(effects.events.map((event) => event['type'])).toEqual([
      'automations.rule.created',
      'automations.rule.updated',
      'automations.rules.paused',
      'automations.rules.resumed',
      'automations.rule.deleted',
    ])
    expect(effects.events[0]?.['payload']).toEqual({ ruleId: rule.id })
    expect(automationRuleListSchema.parse(await (await request(f.headSession)).json())).toEqual([])
  })

  it('paginates every timestamp tie and microsecond neighbor once, retaining filters and department scope', async () => {
    const f = await fixture()
    const rule = await create(f.headSession)
    const otherRule = await create(f.headSession)
    const foreign = await fixture()
    const foreignRule = await create(foreign.headSession)
    await superuserQuery(
      db,
      `insert into app.automation_runs(id,department_id,rule_id,status,detail,at)
      select gen_random_uuid(),$1,$2,'applied','{}',case when n<=55 then '2026-10-01T10:00:00.123456Z'::timestamptz else '2026-10-01T10:00:00.123455Z'::timestamptz end
      from generate_series(1,56) n`,
      [f.department.id, rule.id],
    )
    await superuserQuery(
      db,
      `insert into app.automation_runs(id,department_id,rule_id,status,detail,at)
      values(gen_random_uuid(),$1,$2,'skipped','{}','2026-10-01T09:00:00Z'),
      (gen_random_uuid(),$1,$3,'applied','{}','2026-10-01T11:00:00Z'),
      (gen_random_uuid(),$4,$5,'applied','{}','2026-10-01T12:00:00Z')`,
      [f.department.id, rule.id, otherRule.id, foreign.department.id, foreignRule.id],
    )
    const ids: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const query = new URLSearchParams({ limit: '10', ruleId: rule.id, status: 'applied' })
      if (cursor) query.set('cursor', cursor)
      const response = await request(f.headSession, `/runs?${query}`)
      expect(response.status).toBe(200)
      const page = automationRunListSchema.parse(await response.json())
      expect(page.total).toBe(56)
      expect(page.items.every((run) => run.ruleId === rule.id && run.status === 'applied')).toBe(
        true,
      )
      ids.push(...page.items.map((run) => run.id))
      cursor = page.nextCursor
      if (cursor) expect(decodeRunCursor(cursor)?.at).toBe('2026-10-01T10:00:00.123456Z')
      pages += 1
      expect(pages).toBeLessThan(8)
    } while (cursor)
    expect(ids).toHaveLength(56)
    expect(new Set(ids).size).toBe(56)
    const stored = await superuserQuery<{ id: string }>(
      db,
      "select id from app.automation_runs where department_id=$1 and rule_id=$2 and status='applied' order by at desc,id desc",
      [f.department.id, rule.id],
    )
    expect(ids).toEqual(stored.map((row) => row.id))
    const all = automationRunListSchema.parse(await (await request(f.headSession, '/runs')).json())
    expect(all.total).toBe(58)
    const scoped = automationRunListSchema.parse(
      await (await request(f.headSession, `/runs?ruleId=${foreignRule.id}`)).json(),
    )
    expect(scoped).toEqual({ items: [], total: 0, nextCursor: null })
    expect(
      (await request(f.headSession, `/${foreignRule.id}`, 'PATCH', { name: 'Forbidden' })).status,
    ).toBe(404)
    expect((await request(f.headSession, `/${foreignRule.id}`, 'DELETE')).status).toBe(404)
  })

  it('keeps legacy timestamp cursor semantics and validates invalid cursors before SQL', async () => {
    const f = await fixture()
    const rule = await create(f.headSession)
    await superuserQuery(
      db,
      `insert into app.automation_runs(id,department_id,rule_id,status,detail,at)
      values(gen_random_uuid(),$1,$2,'applied','{}','2026-10-01T10:00:00Z'),
      (gen_random_uuid(),$1,$2,'skipped','{}','2026-10-01T09:00:00Z')`,
      [f.department.id, rule.id],
    )
    const query = new URLSearchParams({ cursor: '2026-10-01T10:00:00Z' })
    const response = await request(f.headSession, `/runs?${query}`)
    expect(response.status).toBe(200)
    const legacy = automationRunListSchema.parse(await response.json())
    expect(legacy.items).toHaveLength(1)
    expect(legacy.items[0]?.status).toBe('skipped')
    expect(legacy.total).toBe(2)
    expect((await request(f.headSession, '/runs?cursor=not-a-cursor')).status).toBe(422)
  })
})

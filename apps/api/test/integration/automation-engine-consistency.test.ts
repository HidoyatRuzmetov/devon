// Real migrated local Postgres and Fastify. No integration keys or external service calls.
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as automationRepo from '../../src/modules/automations/repo.js'
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
describe('actual automation execution', () => {
  it('applies a selected field trigger only to actual changes of that field, while any-field rules match each supported field', async () => {
    const f = await fixture()
    const selected = await request(f.headSession, '', 'POST', {
      ...ruleBody(),
      trigger: 'card_field_changed',
      triggerConfig: { field: 'priority' },
      actions: [{ kind: 'set_priority', priority: 'high' }],
    })
    expect(selected.status).toBe(201)
    const selectedRule = (await selected.json()) as { id: string }
    const any = await request(f.headSession, '', 'POST', {
      ...ruleBody(),
      trigger: 'card_field_changed',
      triggerConfig: {},
      actions: [{ kind: 'add_checklist', checklist: ['Any field changed'] }],
    })
    expect(any.status).toBe(201)
    const anyRule = (await any.json()) as { id: string }
    const fields = ['priority', 'labels', 'dueAt', 'estimate']
    for (let index = 0; index < fields.length; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: f.headSession.headers,
        body: JSON.stringify({ title: `Actual changed field ${fields[index]}` }),
      })
      expect(response.status).toBe(201)
      const card = (await response.json()) as { id: string }
      await evaluateTrigger(
        Fastify({ logger: false }).log,
        f.department.id,
        card.id,
        'card_field_changed',
        f.head.id,
        { changedFields: [fields[index]!] },
      )
      expect(
        (
          await superuserQuery(
            db,
            'select status,detail from app.automation_runs where rule_id=$1 and card_id=$2',
            [selectedRule.id, card.id],
          )
        )[0],
      ).toMatchObject(
        index === 0
          ? { status: 'applied' }
          : { status: 'skipped', detail: { reason: 'field_did_not_match' } },
      )
      expect(
        (
          await superuserQuery(
            db,
            'select status from app.automation_runs where rule_id=$1 and card_id=$2',
            [anyRule.id, card.id],
          )
        )[0],
      ).toMatchObject({ status: 'applied' })
      expect(
        await superuserQuery(db, 'select text from app.card_checklist_items where card_id=$1', [
          card.id,
        ]),
      ).toEqual([{ text: 'Any field changed' }])
      expect(
        await superuserQuery(
          db,
          "select a.id from audit.events a join app.card_checklist_items i on i.id::text=a.subject_id where i.card_id=$1 and a.action='work.checklist_item_added'",
          [card.id],
        ),
      ).toHaveLength(1)
      expect(
        await superuserQuery(
          db,
          "select id from app.outbox_events where type='work.checklist.updated' and payload->>'cardId'=$1",
          [card.id],
        ),
      ).toHaveLength(1)
    }
  })
  it.each(['assign', 'notify_user'] as const)(
    'records a failed %s without claiming an effect when access is revoked after its preflight read',
    async (kind) => {
      const f = await fixture()
      const recipient = await seedMember(db, f.department.id, { role: 'member' })
      const ruleResponse = await request(f.headSession, '', 'POST', {
        ...ruleBody(),
        actions: [{ kind, userId: recipient.id }],
      })
      expect(ruleResponse.status).toBe(201)
      const rule = (await ruleResponse.json()) as { id: string }
      const created = await fetch(`${server.baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: f.headSession.headers,
        body: JSON.stringify({ title: 'Read/write recipient race' }),
      })
      expect(created.status).toBe(201)
      const card = (await created.json()) as {
        id: string
        assigneeUserId: string | null
        version: number
      }
      const read = automationRepo.areActionTargetsEligible
      const preflight = vi
        .spyOn(automationRepo, 'areActionTargetsEligible')
        .mockImplementationOnce(async (...args) => {
          const eligible = await read(...args)
          expect(eligible).toBe(true)
          await superuserQuery(
            db,
            "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
            [f.department.id, recipient.id],
          )
          return eligible
        })
      try {
        await evaluateTrigger(
          Fastify({ logger: false }).log,
          f.department.id,
          card.id,
          'card_created',
          f.head.id,
        )
      } finally {
        preflight.mockRestore()
      }
      expect(
        (
          await superuserQuery(db, 'select assignee_user_id,version from app.cards where id=$1', [
            card.id,
          ])
        )[0],
      ).toMatchObject({ assignee_user_id: card.assigneeUserId, version: card.version })
      expect(
        (
          await superuserQuery(
            db,
            'select status,detail from app.automation_runs where rule_id=$1',
            [rule.id],
          )
        )[0],
      ).toMatchObject({
        status: 'failed',
        detail: { actions: [], error: 'action_target_unavailable' },
      })
      expect(
        await superuserQuery(db, 'select id from app.notifications where user_id=$1', [
          recipient.id,
        ]),
      ).toEqual([])
    },
  )
  it('refuses a label deleted after preflight and records no fictional applied label', async () => {
    const f = await fixture()
    const label = (
      await superuserQuery<{ id: string }>(
        db,
        "insert into app.labels(department_id,name) values($1,'Concurrent label') returning id",
        [f.department.id],
      )
    )[0]!
    const ruleResponse = await request(f.headSession, '', 'POST', {
      ...ruleBody(),
      actions: [{ kind: 'add_label', labelId: label.id }],
    })
    expect(ruleResponse.status).toBe(201)
    const rule = (await ruleResponse.json()) as { id: string }
    const created = await fetch(`${server.baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: f.headSession.headers,
      body: JSON.stringify({ title: 'Read/write label race' }),
    })
    const card = (await created.json()) as { id: string; version: number }
    const read = automationRepo.areActionTargetsEligible
    const preflight = vi
      .spyOn(automationRepo, 'areActionTargetsEligible')
      .mockImplementationOnce(async (...args) => {
        const eligible = await read(...args)
        expect(eligible).toBe(true)
        await superuserQuery(db, 'update app.labels set deleted_at=now() where id=$1', [label.id])
        return eligible
      })
    try {
      await evaluateTrigger(
        Fastify({ logger: false }).log,
        f.department.id,
        card.id,
        'card_created',
        f.head.id,
      )
    } finally {
      preflight.mockRestore()
    }
    expect(
      (await superuserQuery(db, 'select labels,version from app.cards where id=$1', [card.id]))[0],
    ).toMatchObject({ labels: [], version: card.version })
    expect(
      (
        await superuserQuery(db, 'select status,detail from app.automation_runs where rule_id=$1', [
          rule.id,
        ])
      )[0],
    ).toMatchObject({
      status: 'failed',
      detail: { actions: [], error: 'action_target_unavailable' },
    })
  })

  it('matches actual project, unit, named person, rule-author @me, description and custom-field facts while skipping nonmatching cards', async () => {
    const f = await fixture()
    const assignee = await seedMember(db, f.department.id, { role: 'member' })
    const other = await seedMember(db, f.department.id, { role: 'member' })
    await superuserQuery(
      db,
      "update app.users set given_name='Alice',family_name='Roʻzmetov' where id=$1",
      [assignee.id],
    )
    const project = (
      await superuserQuery<{ id: string }>(
        db,
        "insert into app.projects(department_id,title,owner_user_id) values($1,'Public Data',$2) returning id",
        [f.department.id, f.head.id],
      )
    )[0]!
    const unit = (
      await superuserQuery<{ id: string }>(
        db,
        "insert into app.units(department_id,name,path) values($1,'Operations','/') returning id",
        [f.department.id],
      )
    )[0]!
    await superuserQuery(
      db,
      'insert into app.unit_roles(department_id,unit_id,user_id,assigned_by) values($1,$2,$3,$4)',
      [f.department.id, unit.id, assignee.id, f.head.id],
    )
    const field = (
      await superuserQuery<{ id: string }>(
        db,
        "insert into app.field_defs(department_id,applies_to,key,type,created_by_user_id) values($1,'card','approved','checkbox',$2) returning id",
        [f.department.id, f.head.id],
      )
    )[0]!
    const cases = [
      'project:"Public Data"',
      'unit:Operations',
      'assignee:@alice',
      `assignee:@${assignee.login}`,
      "assignee:Ro'zmetov",
      'giver:@me',
      `giver:@${f.head.login}`,
      'description-marker',
      'field:approved:yes',
    ]
    for (let index = 0; index < cases.length; index += 1) {
      const ruleResponse = await request(f.headSession, '', 'POST', {
        ...ruleBody(),
        triggerConfig: { filter: cases[index] },
        actions: [{ kind: 'set_priority', priority: 'high' }],
      })
      expect(ruleResponse.status).toBe(201)
      const rule = (await ruleResponse.json()) as { id: string }
      const cards = await Promise.all(
        [true, false].map(async (matching) => {
          const response = await fetch(`${server.baseUrl}/api/v1/cards`, {
            method: 'POST',
            headers: f.headSession.headers,
            body: JSON.stringify({
              title: `Filter ${index} ${matching}`,
              assigneeUserId: matching ? assignee.id : other.id,
              giverUserId: matching ? f.head.id : other.id,
              projectId: matching ? project.id : null,
              description: matching ? 'description-marker' : 'different description',
            }),
          })
          expect(response.status).toBe(201)
          const card = (await response.json()) as { id: string }
          await superuserQuery(
            db,
            "insert into app.field_values(department_id,def_id,subject_type,subject_id,value) values($1,$2,'card',$3,$4::jsonb)",
            [f.department.id, field.id, card.id, JSON.stringify(matching)],
          )
          return { ...card, matching }
        }),
      )
      for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
        const card = cards[cardIndex]!
        // Actor deliberately differs from rule author: @me must retain the author from saving.
        await evaluateTrigger(
          Fastify({ logger: false }).log,
          f.department.id,
          card.id,
          'card_created',
          assignee.id,
        )
        expect(
          (await superuserQuery(db, 'select priority from app.cards where id=$1', [card.id]))[0]?.[
            'priority'
          ],
        ).toBe(card.matching ? 'high' : 'none')
        expect(
          (
            await superuserQuery(
              db,
              'select status,detail from app.automation_runs where rule_id=$1 and card_id=$2',
              [rule.id, card.id],
            )
          )[0],
        ).toMatchObject(
          card.matching
            ? { status: 'applied', detail: { actions: ['set_priority'] } }
            : { status: 'skipped', detail: { reason: 'filter_did_not_match' } },
        )
      }
      await superuserQuery(db, 'update app.automation_rules set enabled=false where id=$1', [
        rule.id,
      ])
    }
  })
})

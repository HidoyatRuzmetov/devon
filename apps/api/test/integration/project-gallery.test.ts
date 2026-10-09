import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { withContext, type RequestContext } from '@devon/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createFromGallery,
  InvalidProjectMembers,
  InvalidProjectTemplate,
} from '../../src/modules/projects/repo.js'
import { createFromCardTemplate } from '../../src/modules/work/plus-repo.js'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'

let db: Db
let server: Server
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function context(departmentId: string, userId: string, head = false): RequestContext {
  return {
    requestId: randomUUID(),
    departmentId,
    userId,
    actorRole: 'member',
    departmentRole: head ? 'head' : 'member',
    viewAs: false,
    actingForUserId: null,
    ip: '127.0.0.1',
    userAgent: 'local-gallery-regression',
  }
}
async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Gallery transactions',
    slug: `gallery-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const member = await seedMember(db, department.id, { role: 'member' })
  await superuserQuery(
    db,
    `update app.departments set features='{"templates":true}'::jsonb where id=$1`,
    [department.id],
  )
  return { department, head, member, ctx: context(department.id, member.id) }
}
async function template(
  departmentId: string,
  ownerUserId: string,
  payload: unknown,
  scope = 'department',
  kind = 'project',
) {
  const id = randomUUID()
  await superuserQuery(
    db,
    `insert into app.work_templates(id,department_id,owner_user_id,kind,scope,name,payload)
    values($1,$2,$3,$4,$5,'Local transaction template',$6::jsonb)`,
    [id, departmentId, ownerUserId, kind, scope, JSON.stringify(payload)],
  )
  return id
}
async function count(id: string) {
  return (
    await superuserQuery<{ use_count: number }>(
      db,
      'select use_count from app.work_templates where id=$1',
      [id],
    )
  )[0]!.use_count
}
async function consume(ctx: RequestContext, id: string) {
  return withContext(
    ctx,
    async (tx) =>
      (
        await tx.raw<{ payload: unknown }>(
          sql`select app.consume_project_template(${id}::uuid) as payload`,
        )
      )[0]!.payload,
  )
}
async function effects(departmentId: string) {
  return (
    await superuserQuery<{ projects: string; cards: string; audit: string; outbox: string }>(
      db,
      `select
    (select count(*) from app.projects where department_id=$1) as projects,
    (select count(*) from app.cards where department_id=$1) as cards,
    (select count(*) from audit.events where department_id=$1) as audit,
    (select count(*) from app.outbox_events where department_id=$1) as outbox`,
      [departmentId],
    )
  )[0]!
}
async function blockedBy(pid: number) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const rows = await superuserQuery(
      db,
      'select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))',
      [pid],
    )
    if (rows.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected gallery operation to wait for the actual template transaction')
}

describe('atomic gallery project creation through actual application-role transactions', () => {
  it('card consume helper has restricted grants and refuses foreign/private/view-as/missing/removed calls', async () => {
    const f = await fixture()
    const shared = await template(
      f.department.id,
      f.head.id,
      { title: 'Shared card' },
      'department',
      'card',
    )
    const privateId = await template(
      f.department.id,
      f.head.id,
      { title: 'Private card' },
      'personal',
      'card',
    )
    const foreign = await seedDepartment(db, {
      name: 'Foreign card',
      slug: `foreign-card-${randomUUID()}`,
    })
    const foreignId = await template(
      foreign.id,
      f.head.id,
      { title: 'Foreign card' },
      'department',
      'card',
    )
    const projectId = await template(f.department.id, f.head.id, { title: 'Wrong kind' })
    const call = (ctx: RequestContext, id: string) =>
      withContext(
        ctx,
        async (tx) =>
          (
            await tx.raw<{ payload: unknown }>(
              sql`select app.consume_card_template(${id}::uuid) as payload`,
            )
          )[0]!.payload,
      )
    const answers = await Promise.all([
      call(f.ctx, privateId),
      call(f.ctx, foreignId),
      call(f.ctx, projectId),
      call(f.ctx, randomUUID()),
      call({ ...f.ctx, viewAs: true }, shared),
      call({ ...f.ctx, userId: null }, shared),
      call({ ...f.ctx, departmentId: null }, shared),
      call({ ...f.ctx, actorRole: 'super_admin' }, shared),
    ])
    expect(answers).toEqual(Array.from({ length: 8 }, () => null))
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
      [f.department.id, f.member.id],
    )
    expect(await call(f.ctx, shared)).toBeNull()
    expect(await count(shared)).toBe(0)
    const grants = await superuserQuery<{
      rolbypassrls: boolean
      proconfig: string[]
      public_execute: boolean
      app_execute: boolean
    }>(
      db,
      `select r.rolbypassrls,p.proconfig,
      exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,
      has_function_privilege('devon_app','app.consume_card_template(uuid)','EXECUTE') as app_execute
      from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='app.consume_card_template(uuid)'::regprocedure`,
    )
    expect(grants[0]).toMatchObject({
      rolbypassrls: true,
      proconfig: ['search_path=pg_catalog'],
      public_execute: false,
      app_execute: true,
    })
  })

  it('shared card template increments use count and creates its checklist in the same transaction', async () => {
    const f = await fixture()
    const id = await template(
      f.department.id,
      f.head.id,
      { title: 'Shared card', checklist: ['First check', 'Second check'] },
      'department',
      'card',
    )
    const result = await createFromCardTemplate(f.ctx, f.department.id, id, {
      assigneeUserId: f.member.id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected template card')
    const lines = await superuserQuery<{ text: string }>(
      db,
      'select text from app.card_checklist_items where card_id=$1 order by order_key',
      [result.id],
    )
    expect(lines.map((line) => line.text)).toEqual(['First check', 'Second check'])
    expect(await count(id)).toBe(1)
    expect(await effects(f.department.id)).toMatchObject({
      projects: '0',
      cards: '1',
      audit: '2',
      outbox: '1',
    })
  })

  it('card template count/card/activity/audit/outbox roll back if payload, labels or checklist insertion fail', async () => {
    const f = await fixture()
    const before = await effects(f.department.id)
    const malformed = await template(
      f.department.id,
      f.head.id,
      { title: '' },
      'department',
      'card',
    )
    await expect(
      createFromCardTemplate(f.ctx, f.department.id, malformed, {}),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(await count(malformed)).toBe(0)
    const labels = await template(
      f.department.id,
      f.head.id,
      { title: 'Invalid reference', labels: [randomUUID()] },
      'department',
      'card',
    )
    await expect(createFromCardTemplate(f.ctx, f.department.id, labels, {})).rejects.toMatchObject({
      statusCode: 422,
    })
    expect(await count(labels)).toBe(0)
    const valid = await template(
      f.department.id,
      f.head.id,
      { title: 'Checklist refusal', checklist: ['Synthetic checklist failure'] },
      'department',
      'card',
    )
    await superuserQuery(
      db,
      `create function app.card_template_test_refusal() returns trigger language plpgsql as $$ begin
      if new.text='Synthetic checklist failure' then raise exception 'Synthetic checklist refusal'; end if; return new; end $$;
      create trigger card_template_test_refusal before insert on app.card_checklist_items for each row execute function app.card_template_test_refusal()`,
    )
    try {
      await expect(createFromCardTemplate(f.ctx, f.department.id, valid, {})).rejects.toMatchObject(
        { cause: { message: 'Synthetic checklist refusal' } },
      )
      expect(await count(valid)).toBe(0)
      expect(await effects(f.department.id)).toEqual(before)
      expect(
        await superuserQuery(db, 'select id from app.card_activity where department_id=$1', [
          f.department.id,
        ]),
      ).toEqual([])
    } finally {
      await superuserQuery(
        db,
        'drop trigger card_template_test_refusal on app.card_checklist_items; drop function app.card_template_test_refusal()',
      )
    }
  })

  it('restricts the consume helper owner, search path and execute privileges', async () => {
    const rows = await superuserQuery<{
      rolbypassrls: boolean
      proconfig: string[]
      public_execute: boolean
      app_execute: boolean
    }>(
      db,
      `select r.rolbypassrls,p.proconfig,
      exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,
      has_function_privilege('devon_app','app.consume_project_template(uuid)','EXECUTE') as app_execute
      from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='app.consume_project_template(uuid)'::regprocedure`,
    )
    expect(rows[0]).toMatchObject({
      rolbypassrls: true,
      proconfig: ['search_path=pg_catalog'],
      public_execute: false,
      app_execute: true,
    })
  })

  it('allows members to consume shared and own personal templates without granting template editing', async () => {
    const f = await fixture()
    const shared = await template(f.department.id, f.head.id, { title: 'Shared project' })
    expect(await consume(f.ctx, shared)).toEqual({ title: 'Shared project' })
    expect(await count(shared)).toBe(1)
    const changed = await withContext(f.ctx, (tx) =>
      tx.raw(
        sql`update app.work_templates set name='Forbidden edit' where id=${shared} returning id`,
      ),
    )
    expect(changed).toEqual([])
    const own = await template(
      f.department.id,
      f.member.id,
      { title: 'Private project' },
      'personal',
    )
    expect(await consume(f.ctx, own)).toEqual({ title: 'Private project' })
    expect(await count(own)).toBe(1)
  })

  it('refuses missing, foreign, private, card-kind, deleted and view-as calls without changing counts', async () => {
    const f = await fixture()
    const shared = await template(f.department.id, f.head.id, { title: 'Shared' })
    const privateId = await template(
      f.department.id,
      f.head.id,
      { title: 'Other private' },
      'personal',
    )
    const cardId = await template(
      f.department.id,
      f.head.id,
      { title: 'Card template' },
      'department',
      'card',
    )
    const foreign = await seedDepartment(db, { name: 'Foreign', slug: `foreign-${randomUUID()}` })
    const foreignId = await template(foreign.id, f.head.id, { title: 'Foreign' })
    const calls: [RequestContext, string][] = [
      [f.ctx, randomUUID()],
      [f.ctx, privateId],
      [f.ctx, cardId],
      [f.ctx, foreignId],
      [{ ...f.ctx, userId: null }, shared],
      [{ ...f.ctx, departmentId: null }, shared],
      [{ ...f.ctx, actorRole: null }, shared],
      [{ ...f.ctx, actorRole: 'super_admin' }, shared],
      [{ ...f.ctx, viewAs: true }, shared],
    ]
    const answers = await Promise.all(calls.map(([ctx, id]) => consume(ctx, id)))
    expect(answers).toEqual(calls.map(() => null))
    await superuserQuery(db, 'update app.work_templates set deleted_at=now() where id=$1', [shared])
    expect(await consume(f.ctx, shared)).toBeNull()
    expect(await count(shared)).toBe(0)
    expect(await count(privateId)).toBe(0)
    expect(await count(cardId)).toBe(0)
    expect(await count(foreignId)).toBe(0)
  })

  it('refuses removed/locked actors, inactive departments and disabled capability', async () => {
    const f = await fixture()
    const id = await template(f.department.id, f.head.id, { title: 'Shared' })
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
      [f.department.id, f.member.id],
    )
    expect(await consume(f.ctx, id)).toBeNull()
    await superuserQuery(
      db,
      "update app.memberships set status='active' where department_id=$1 and user_id=$2",
      [f.department.id, f.member.id],
    )
    await superuserQuery(db, "update app.users set status='locked' where id=$1", [f.member.id])
    expect(await consume(f.ctx, id)).toBeNull()
    await superuserQuery(db, "update app.users set status='active' where id=$1", [f.member.id])
    await superuserQuery(db, "update app.departments set status='paused_by_admin' where id=$1", [
      f.department.id,
    ])
    expect(await consume(f.ctx, id)).toBeNull()
    await superuserQuery(
      db,
      "update app.departments set status='active',features='{}'::jsonb where id=$1",
      [f.department.id],
    )
    expect(await consume(f.ctx, id)).toBeNull()
    expect(await count(id)).toBe(0)
  })

  it('creates ordered objective cards, milestones, activity, audit/outbox and one use together', async () => {
    const f = await fixture()
    const id = await template(f.department.id, f.head.id, {
      title: 'Shared',
      colour: '#2563eb',
      milestones: [{ title: 'Review', offsetDays: 2 }],
      cards: [
        { title: 'First', estimateMin: 60 },
        { title: 'Second', offsetDays: 3 },
      ],
    })
    const project = await createFromGallery(f.ctx, {
      templateId: id,
      departmentId: f.department.id,
      ownerUserId: f.member.id,
      members: [f.member.id],
    })
    expect(project).toMatchObject({
      title: 'Shared',
      objectiveTotal: 2,
      progress: 0,
      colour: '#2563eb',
      members: [f.member.id],
    })
    expect(project?.milestones[0]?.title).toBe('Review')
    const cards = await superuserQuery<{
      title: string
      order_key: string
      source: string
      project_scope: string
    }>(
      db,
      'select title,order_key,source,project_scope from app.cards where project_id=$1 order by order_key',
      [project!.id],
    )
    expect(cards.map((c) => c.title)).toEqual(['First', 'Second'])
    expect(new Set(cards.map((c) => c.order_key)).size).toBe(2)
    expect(cards.every((c) => c.source === 'template' && c.project_scope === 'objective')).toBe(
      true,
    )
    expect(await count(id)).toBe(1)
    expect(await effects(f.department.id)).toMatchObject({
      projects: '1',
      cards: '2',
      audit: '4',
      outbox: '3',
    })
  })

  it('rolls back consumption and all effects for invalid payload or project members', async () => {
    const f = await fixture()
    const before = await effects(f.department.id)
    const malformed = await template(f.department.id, f.head.id, {
      title: 'Invalid',
      cards: [{ title: '' }],
    })
    await expect(
      createFromGallery(f.ctx, {
        templateId: malformed,
        departmentId: f.department.id,
        ownerUserId: f.member.id,
        members: [f.member.id],
      }),
    ).rejects.toBeInstanceOf(InvalidProjectTemplate)
    expect(await count(malformed)).toBe(0)
    const valid = await template(f.department.id, f.head.id, {
      title: 'Valid',
      cards: [{ title: 'Task' }],
    })
    await expect(
      createFromGallery(f.ctx, {
        templateId: valid,
        departmentId: f.department.id,
        ownerUserId: f.member.id,
        members: [randomUUID()],
      }),
    ).rejects.toBeInstanceOf(InvalidProjectMembers)
    expect(await count(valid)).toBe(0)
    expect(await effects(f.department.id)).toEqual(before)
  })

  it('rolls back an inserted first card when the second write fails', async () => {
    const f = await fixture()
    const id = await template(f.department.id, f.head.id, {
      title: 'Rollback',
      cards: [{ title: 'First succeeds' }, { title: 'Synthetic second failure' }],
    })
    const before = await effects(f.department.id)
    await superuserQuery(
      db,
      `create function app.gallery_test_refusal() returns trigger language plpgsql as $$ begin
      if new.title='Synthetic second failure' then raise exception 'Synthetic gallery refusal'; end if; return new; end $$;
      create trigger gallery_test_refusal before insert on app.cards for each row execute function app.gallery_test_refusal()`,
    )
    try {
      await expect(
        createFromGallery(f.ctx, {
          templateId: id,
          departmentId: f.department.id,
          ownerUserId: f.member.id,
          members: [f.member.id],
        }),
      ).rejects.toMatchObject({ cause: { message: 'Synthetic gallery refusal' } })
      expect(await count(id)).toBe(0)
      expect(await effects(f.department.id)).toEqual(before)
    } finally {
      await superuserQuery(
        db,
        'drop trigger gallery_test_refusal on app.cards; drop function app.gallery_test_refusal()',
      )
    }
  })

  it.each(['edit', 'delete'] as const)(
    'waits for a concurrent template %s and uses its committed state',
    async (operation) => {
      const f = await fixture()
      const id = await template(f.department.id, f.head.id, { title: 'Before concurrent edit' })
      const blocker = new Client({ connectionString: db.superuserUrl })
      await blocker.connect()
      try {
        await blocker.query('begin')
        const pid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid'))
          .rows[0]!.pid
        await blocker.query(
          operation === 'edit'
            ? `update app.work_templates set payload='{"title":"Committed edit"}'::jsonb where id=$1`
            : 'update app.work_templates set deleted_at=now() where id=$1',
          [id],
        )
        const creation = createFromGallery(f.ctx, {
          templateId: id,
          departmentId: f.department.id,
          ownerUserId: f.member.id,
          members: [f.member.id],
        })
        await blockedBy(pid)
        await blocker.query('commit')
        if (operation === 'edit') {
          expect((await creation)?.title).toBe('Committed edit')
          expect(await count(id)).toBe(1)
        } else {
          expect(await creation).toBeNull()
          expect(await count(id)).toBe(0)
          expect(await effects(f.department.id)).toMatchObject({
            projects: '0',
            cards: '0',
            audit: '0',
            outbox: '0',
          })
        }
      } finally {
        await blocker.query('rollback')
        await blocker.end()
      }
    },
  )
})

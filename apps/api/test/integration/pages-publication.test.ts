import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as repo from '../../src/modules/pages/repo.js'
import type { AuditCtx } from '../../src/types.js'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  loginAs,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let departmentId: string
let ctx: AuditCtx & { userId: string }
let session: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Knowledge live QA', slug: `pages-live-${randomUUID()}` })
  ).id
  const head = await seedMember(db, departmentId, { role: 'head' })
  session = await loginAs(server.baseUrl, head.login)
  ctx = {
    userId: head.id,
    actorRole: 'head',
    requestId: randomUUID(),
    actingForUserId: null,
    ip: '',
    userAgent: 'pages-publication-qa',
  }
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
async function receipts(id: string, key = 'pageId') {
  return superuserQuery(
    db,
    'select type,payload from app.outbox_events where department_id=$1 and payload->>$2=$3 order by created_at,id',
    [departmentId, key, id],
  )
}
async function snapshot(id: string) {
  return (
    await superuserQuery(
      db,
      `select p.title,p.version,p.deleted_at is not null as deleted,
       (select count(*)::int from app.page_versions where page_id=p.id) as versions,
       (select count(*)::int from audit.events where subject_id=p.id::text) as audits,
       (select count(*)::int from app.outbox_events where payload->>'pageId'=p.id::text) as events
       from app.pages p where p.id=$1`,
      [id],
    )
  )[0]
}
async function rejectPublication(type: string, work: () => Promise<unknown>) {
  const trigger = `qa_pages_${randomUUID().replaceAll('-', '')}`
  // Both identifiers/values are locally generated or a fixed case name, never user input.
  await superuserQuery(
    db,
    `create function app.${trigger}() returns trigger language plpgsql as $$
     begin if new.type='${type}' and new.department_id='${departmentId}'
       then raise exception 'Synthetic knowledge publication failure'; end if; return new; end $$;
     create trigger ${trigger} before insert on app.outbox_events for each row execute function app.${trigger}();`,
  )
  try {
    await expect(work()).rejects.toThrow('Synthetic knowledge publication failure')
  } finally {
    await superuserQuery(
      db,
      `drop trigger ${trigger} on app.outbox_events; drop function app.${trigger}();`,
    )
  }
}
describe('knowledge mutations publish only committed identifier receipts', () => {
  it('publishes each persisted page lifecycle step without the title or content', async () => {
    const title = `Private knowledge text ${randomUUID()}`
    const page = await repo.createPage(departmentId, ctx.userId, { kind: 'note', title }, ctx)
    const versions = await repo.listVersions(departmentId, page.id, ctx)
    expect(versions).toHaveLength(1)
    expect(
      await repo.patchPage(
        departmentId,
        ctx.userId,
        page.id,
        { title: `${title} edited`, version: page.version },
        ctx,
      ),
    ).toMatchObject({ ok: 'done' })
    expect(
      await repo.restoreVersion(departmentId, ctx.userId, page.id, versions[0]!.id, ctx),
    ).toMatchObject({ ok: 'done' })
    expect(await repo.deletePage(departmentId, page.id, ctx)).toBe(true)
    expect(
      (
        await fetch(`${server.baseUrl}/api/v1/pages/${page.id}/versions/${versions[0]!.id}`, {
          headers: session.headers,
        })
      ).status,
    ).toBe(404)
    expect(await repo.restorePage(departmentId, page.id, ctx)).toBe('restored')
    expect((await repo.getPage(departmentId, page.id, ctx))?.title).toBe(title)
    const events = await receipts(page.id)
    expect(events.map((row) => row['type']).sort()).toEqual(
      [
        'pages.page.created',
        'pages.page.updated',
        'pages.page.version_restored',
        'pages.page.deleted',
        'pages.page.restored',
      ].sort(),
    )
    for (const event of events) {
      expect(event['payload']).toMatchObject({ pageId: page.id, actorUserId: ctx.userId })
      expect(Object.keys(event['payload'] as object).sort()).toEqual(
        ['pages.page.updated', 'pages.page.version_restored'].includes(String(event['type']))
          ? ['actorUserId', 'pageId', 'version']
          : ['actorUserId', 'pageId'],
      )
    }
    const read = await fetch(`${server.baseUrl}/api/v1/pages/${page.id}`, {
      headers: session.headers,
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ title, version: 5 })
  })
  it('emits no second receipt for a stale revision or missing/deleted page', async () => {
    const page = await repo.createPage(
      departmentId,
      ctx.userId,
      { kind: 'note', title: 'Conflict boundary' },
      ctx,
    )
    expect(
      await repo.patchPage(
        departmentId,
        ctx.userId,
        page.id,
        { title: 'Changed', version: page.version },
        ctx,
      ),
    ).toMatchObject({ ok: 'done' })
    const before = await snapshot(page.id)
    expect(
      await repo.patchPage(
        departmentId,
        ctx.userId,
        page.id,
        { title: 'Stale', version: page.version },
        ctx,
      ),
    ).toEqual({ ok: 'conflict' })
    expect(await snapshot(page.id)).toEqual(before)
    expect(await repo.deletePage(departmentId, page.id, ctx)).toBe(true)
    const deleted = await snapshot(page.id)
    expect(await repo.deletePage(departmentId, page.id, ctx)).toBe(false)
    expect(await repo.restoreVersion(departmentId, ctx.userId, page.id, randomUUID(), ctx)).toEqual(
      { ok: 'not_found' },
    )
    expect(await snapshot(page.id)).toEqual(deleted)
  })
  it.each([
    'pages.page.updated',
    'pages.page.deleted',
    'pages.page.restored',
    'pages.page.version_restored',
  ])('rolls back data, history and audit when %s publication fails', async (type) => {
    const page = await repo.createPage(
      departmentId,
      ctx.userId,
      { kind: 'note', title: `Atomic ${type}` },
      ctx,
    )
    const version = (await repo.listVersions(departmentId, page.id, ctx))[0]!
    if (type === 'pages.page.restored')
      expect(await repo.deletePage(departmentId, page.id, ctx)).toBe(true)
    const before = await snapshot(page.id)
    await rejectPublication(type, () => {
      if (type === 'pages.page.updated')
        return repo.patchPage(
          departmentId,
          ctx.userId,
          page.id,
          { title: 'Rejected edit', version: page.version },
          ctx,
        )
      if (type === 'pages.page.deleted') return repo.deletePage(departmentId, page.id, ctx)
      if (type === 'pages.page.restored') return repo.restorePage(departmentId, page.id, ctx)
      return repo.restoreVersion(departmentId, ctx.userId, page.id, version.id, ctx)
    })
    expect(await snapshot(page.id)).toEqual(before)
  })
  it('does not leave a created page or initial history behind when publication fails', async () => {
    const title = `Rejected creation ${randomUUID()}`
    await rejectPublication('pages.page.created', () =>
      repo.createPage(departmentId, ctx.userId, { kind: 'note', title }, ctx),
    )
    expect(
      await superuserQuery(db, 'select id from app.pages where department_id=$1 and title=$2', [
        departmentId,
        title,
      ]),
    ).toEqual([])
    expect(
      await superuserQuery(
        db,
        'select id from app.page_versions where department_id=$1 and title=$2',
        [departmentId, title],
      ),
    ).toEqual([])
  })
  it('publishes template management and rolls a refused template save back', async () => {
    const template = await repo.createOnboardingTemplate(
      departmentId,
      ctx.userId,
      { name: 'Live template' },
      ctx,
    )
    const changed = await repo.patchOnboardingTemplate(
      departmentId,
      template.id,
      { enabled: true, version: template.version },
      ctx,
    )
    expect(changed).toMatchObject({ ok: 'done' })
    if (changed.ok !== 'done') throw new Error('Expected real template write')
    await rejectPublication('pages.onboarding_template.updated', () =>
      repo.patchOnboardingTemplate(
        departmentId,
        template.id,
        { name: 'Rejected', version: changed.row.version },
        ctx,
      ),
    )
    expect(
      (await repo.listOnboardingTemplates(departmentId, ctx)).find((row) => row.id === template.id),
    ).toMatchObject({ name: 'Live template', enabled: true, version: changed.row.version })
    expect(await repo.deleteOnboardingTemplate(departmentId, template.id, ctx)).toBe(true)
    expect((await receipts(template.id, 'templateId')).map((row) => row['type']).sort()).toEqual(
      [
        'pages.onboarding_template.created',
        'pages.onboarding_template.updated',
        'pages.onboarding_template.deleted',
      ].sort(),
    )
  })
})

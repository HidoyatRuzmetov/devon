import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  archiveTemplate,
  createFromCardTemplate,
  createTemplate,
  getTemplate,
  listTemplates,
  patchTemplate,
} from '../../src/modules/work/plus-repo.js'
import {
  seedDepartment,
  seedMember,
  loginAs,
  startHarness,
  stopHarness,
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
    userAgent: 'local-template-privacy-regression',
  }
}
async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Template privacy',
    slug: `privacy-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const owner = await seedMember(db, department.id, { role: 'member' })
  const peer = await seedMember(db, department.id, { role: 'member' })
  await superuserQuery(
    db,
    `update app.departments set features='{"templates":true}'::jsonb where id=$1`,
    [department.id],
  )
  return {
    department,
    head: context(department.id, head.id, true),
    owner: context(department.id, owner.id),
    peer: context(department.id, peer.id),
  }
}

describe('work template personal privacy under actual application-role RLS', () => {
  it('demoted creator cannot curate or privatize department templates, but can still use them', async () => {
    const f = await fixture()
    const shared = await createTemplate(f.head, f.department.id, f.head.userId!, {
      kind: 'card',
      scope: 'department',
      name: 'Former head shared',
      payload: { title: 'Shared remains available' },
    })
    const [user] = await superuserQuery<{ login: string }>(
      db,
      'select login from app.users where id=$1',
      [f.head.userId],
    )
    await superuserQuery(
      db,
      "update app.memberships set role='member' where department_id=$1 and user_id=$2",
      [f.department.id, f.head.userId],
    )
    const member = { ...f.head, departmentRole: 'member' as const }
    const session = await loginAs(server.baseUrl, user!.login)
    const listed = await fetch(`${server.baseUrl}/api/v1/work/templates?kind=card`, {
      headers: { cookie: session.cookie },
    })
    expect(listed.status).toBe(200)
    expect(
      ((await listed.json()) as { id: string; canManage: boolean }[]).find(
        (row) => row.id === shared,
      )?.canManage,
    ).toBe(false)
    for (const patch of [{ name: 'Former head rename' }, { scope: 'personal' }]) {
      const response = await fetch(`${server.baseUrl}/api/v1/work/templates/${shared}`, {
        method: 'PATCH',
        headers: session.headers,
        body: JSON.stringify(patch),
      })
      expect(response.status).toBe(403)
    }
    const removed = await fetch(`${server.baseUrl}/api/v1/work/templates/${shared}`, {
      method: 'DELETE',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
    })
    expect(removed.status).toBe(403)
    expect(await archiveTemplate(member, f.department.id, shared)).toBe(false)
    expect(await patchTemplate(member, f.department.id, shared, { scope: 'personal' })).toBe(false)
    expect((await getTemplate(member, f.department.id, shared))?.scope).toBe('department')
    expect((await createFromCardTemplate(member, f.department.id, shared, {})).ok).toBe(true)
  })
  it('list, direct read and SQL hide a personal template from another member and the head', async () => {
    const f = await fixture()
    const privateId = await createTemplate(f.owner, f.department.id, f.owner.userId!, {
      kind: 'card',
      scope: 'personal',
      name: 'Private instruction',
      payload: { title: 'Private instruction' },
    })
    const shared = await createTemplate(f.head, f.department.id, f.head.userId!, {
      kind: 'card',
      scope: 'department',
      name: 'Shared instruction',
      payload: { title: 'Shared instruction' },
    })
    const visible = await listTemplates(f.owner, f.department.id, 'card')
    expect(visible.map((row) => row.id)).toEqual(expect.arrayContaining([privateId, shared]))
    for (const viewer of [f.head, f.peer, { ...f.head, viewAs: true }]) {
      expect((await listTemplates(viewer, f.department.id, 'card')).map((row) => row.id)).toEqual([
        shared,
      ])
      expect(await getTemplate(viewer, f.department.id, privateId)).toBeNull()
      expect(
        await withContext(viewer, (tx) =>
          tx.raw(sql`select id, name, payload from app.work_templates where id=${privateId}`),
        ),
      ).toEqual([])
      expect(await createFromCardTemplate(viewer, f.department.id, privateId, {})).toEqual({
        ok: false,
        reason: 'not_found',
      })
    }
    expect((await getTemplate(f.owner, f.department.id, privateId))?.useCount).toBe(0)
  })

  it('owner can create/edit/use/remove personal and head can curate shared without changing another owner private row', async () => {
    const f = await fixture()
    const privateId = await createTemplate(f.owner, f.department.id, f.owner.userId!, {
      kind: 'card',
      scope: 'personal',
      name: 'Private edit',
      payload: { title: 'Personal card', checklist: ['Owner instruction'] },
    })
    const shared = await createTemplate(f.head, f.department.id, f.head.userId!, {
      kind: 'card',
      scope: 'department',
      name: 'Shared edit',
      payload: { title: 'Shared card' },
    })
    expect(await patchTemplate(f.owner, f.department.id, privateId, { name: 'Owner edited' })).toBe(
      true,
    )
    expect(
      await patchTemplate(f.head, f.department.id, privateId, { name: 'Forbidden head edit' }),
    ).toBe(false)
    expect(
      await patchTemplate(f.peer, f.department.id, privateId, { name: 'Forbidden peer edit' }),
    ).toBe(false)
    expect(await archiveTemplate(f.head, f.department.id, privateId)).toBe(false)
    expect(await archiveTemplate(f.peer, f.department.id, privateId)).toBe(false)
    expect((await getTemplate(f.owner, f.department.id, privateId))?.name).toBe('Owner edited')
    const result = await createFromCardTemplate(f.owner, f.department.id, privateId, {})
    expect(result.ok).toBe(true)
    expect((await getTemplate(f.owner, f.department.id, privateId))?.useCount).toBe(1)
    expect(await patchTemplate(f.head, f.department.id, shared, { name: 'Head curated' })).toBe(
      true,
    )
    expect((await getTemplate(f.peer, f.department.id, shared))?.name).toBe('Head curated')
    expect((await createFromCardTemplate(f.peer, f.department.id, shared, {})).ok).toBe(true)
    expect(await archiveTemplate(f.owner, f.department.id, privateId)).toBe(true)
    expect(await getTemplate(f.owner, f.department.id, privateId)).toBeNull()
    expect(await archiveTemplate(f.head, f.department.id, shared)).toBe(true)
  })

  it('read-only view-as and member department authoring cannot write through operation policies', async () => {
    const f = await fixture()
    const shared = await createTemplate(f.head, f.department.id, f.head.userId!, {
      kind: 'card',
      scope: 'department',
      name: 'Shared boundary',
      payload: { title: 'Shared boundary' },
    })
    const viewAs = { ...f.head, viewAs: true }
    expect(await patchTemplate(viewAs, f.department.id, shared, { name: 'View-as write' })).toBe(
      false,
    )
    expect(await archiveTemplate(viewAs, f.department.id, shared)).toBe(false)
    await expect(
      createTemplate(viewAs, f.department.id, f.head.userId!, {
        kind: 'card',
        scope: 'personal',
        name: 'View-as create',
        payload: { title: 'View-as create' },
      }),
    ).rejects.toThrow()
    await expect(
      createTemplate(f.owner, f.department.id, f.owner.userId!, {
        kind: 'card',
        scope: 'department',
        name: 'Member department create',
        payload: { title: 'Member department create' },
      }),
    ).rejects.toThrow()
    const personal = await createTemplate(f.owner, f.department.id, f.owner.userId!, {
      kind: 'card',
      scope: 'personal',
      name: 'Member personal',
      payload: { title: 'Member personal' },
    })
    await expect(
      patchTemplate(f.owner, f.department.id, personal, { scope: 'department' }),
    ).rejects.toThrow()
    expect((await getTemplate(f.owner, f.department.id, personal))?.scope).toBe('personal')
  })
})

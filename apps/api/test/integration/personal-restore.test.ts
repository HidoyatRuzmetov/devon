import { personalDeleteReceiptSchema } from '@devon/contracts'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { restoreTask } from '../../src/modules/personal/repo.js'
import type { AuditCtx } from '../../src/types.js'
import { cookieHeader, parseCookies } from '../checks/http.js'
import {
  loginAs,
  seedBareUser,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type SeededUser,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let owner: SeededUser
let head: SeededUser
let admin: SeededUser
let departmentId: string
let ownerSession: Session
let headSession: Session
let adminSession: Session
const kinds = ['tasks'] as const
type Kind = (typeof kinds)[number]
type ItemSnapshot = { id: string; version: number; title: string; createdAt: string }
type DeletedRow = {
  id: string
  user_id: string
  deleted: boolean
  deleted_operation_id: string | null
  version: number
}
type TaskState = DeletedRow & { parent_id: string | null }
type AuditRow = {
  id: string
  actor_user_id: string
  action: string
  subject_id: string | null
  department_id: string | null
  after: unknown
}
const table = { tasks: 'personal_tasks' }

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Personal restore QA',
    slug: `personal-${randomUUID()}`,
  })
  departmentId = department.id
  owner = await seedMember(db, departmentId, { role: 'member' })
  head = await seedMember(db, departmentId, { role: 'head' })
  admin = await seedBareUser(db, { instanceRole: 'super_admin' })
  ownerSession = await loginAs(server.baseUrl, owner.login)
  headSession = await loginAs(server.baseUrl, head.login)
  adminSession = await loginAs(server.baseUrl, admin.login)
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})

function request(session: Session, path: string, method = 'GET', body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/personal/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function create(kind: Kind, session = ownerSession, extra: Record<string, unknown> = {}) {
  const response = await request(session, kind, 'POST', { title: `QA ${randomUUID()}`, ...extra })
  expect(response.status).toBe(201)
  return (await response.json()) as ItemSnapshot
}
async function remove(kind: Kind, id: string, session = ownerSession) {
  const response = await request(session, `${kind}/${id}?receipt=true`, 'DELETE')
  expect(response.status).toBe(200)
  return personalDeleteReceiptSchema.parse(await response.json())
}
function restore(kind: Kind, id: string, token: string, session = ownerSession) {
  return request(session, `${kind}/${id}/restore`, 'POST', { restoreToken: token })
}
async function rows(_kind: Kind, ids: string[]) {
  return superuserQuery<TaskState>(
    db,
    `select id,user_id,parent_id,deleted_at is not null as deleted,deleted_operation_id,version
      from app.personal_tasks where id=any($1::uuid[]) order by id`,
    [ids],
  )
}
async function itemState(kind: Kind, id: string) {
  return superuserQuery<DeletedRow>(
    db,
    `select id,user_id,deleted_at is not null as deleted,deleted_operation_id,version
      from app.${table[kind]} where id=$1`,
    [id],
  )
}
async function audit(ids: string[]) {
  return superuserQuery<AuditRow>(
    db,
    'select id,actor_user_id,action,subject_id,department_id,after from audit.events where subject_id=any($1::text[]) order by at,id',
    [ids],
  )
}
function ctx(user: SeededUser): AuditCtx {
  return {
    userId: user.id,
    actorRole: 'member',
    actingForUserId: null,
    requestId: randomUUID(),
    ip: '127.0.0.1',
    userAgent: 'personal-local-regression',
  }
}
async function blockedBy(blocker: number, count = 1) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiters = await superuserQuery(
      db,
      `with recursive waiting as (
      select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))
      union
      select a.pid from pg_stat_activity a join waiting w on w.pid = any(pg_blocking_pids(a.pid))
    ) select pid from waiting`,
      [blocker],
    )
    if (waiters.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Expected ${count} actual personal write lock waiters`)
}

describe('personal persisted deletion and operation-bound Undo', () => {
  it('restores only same-operation owner descendants, leaving historical and foreign-owner children untouched', async () => {
    const root = await create('tasks')
    const child = await create('tasks', ownerSession, { parentId: root.id })
    const grandchild = await create('tasks', ownerSession, { parentId: child.id })
    const historical = await create('tasks', ownerSession, { parentId: root.id })
    const historicalReceipt = await remove('tasks', historical.id)
    const foreign = randomUUID()
    // Corrupt foreign links are fixture data: they must not turn subtree traversal into an owner exception.
    await superuserQuery(
      db,
      'insert into app.personal_tasks(id,user_id,parent_id,title) values($1,$2,$3,$4)',
      [foreign, head.id, root.id, 'Foreign owner private task'],
    )
    const receipt = await remove('tasks', root.id)
    const ids = [root.id, child.id, grandchild.id, historical.id, foreign]
    // Equal timestamps are not an operation identity. Historical rows still must not be resurrected.
    await superuserQuery(
      db,
      'update app.personal_tasks set deleted_at=(select deleted_at from app.personal_tasks where id=$1) where id=$2',
      [root.id, historical.id],
    )
    const before = await rows('tasks', ids)
    expect(
      before
        .filter((row) => row.deleted_operation_id === receipt.restoreToken)
        .map((row) => row.id)
        .sort(),
    ).toEqual([root.id, child.id, grandchild.id].sort())
    expect((await restore('tasks', historical.id, historicalReceipt.restoreToken)).status).toBe(409)
    expect(await rows('tasks', ids)).toEqual(before)
    const restored = await restore('tasks', root.id, receipt.restoreToken)
    expect(restored.status).toBe(200)
    expect(((await restored.json()) as ItemSnapshot).version).toBe(3)
    const persisted = await rows('tasks', ids)
    expect(
      persisted
        .filter((row) => !row.deleted && row.user_id === owner.id)
        .map((row) => row.id)
        .sort(),
    ).toEqual([root.id, child.id, grandchild.id].sort())
    expect(persisted.find((row) => row.id === historical.id)).toMatchObject({
      deleted: true,
      deleted_operation_id: historicalReceipt.restoreToken,
    })
    expect(persisted.find((row) => row.id === foreign)).toMatchObject({
      deleted: false,
      version: 1,
      user_id: head.id,
    })
    const history = await audit([root.id])
    expect(history.map((row) => row.action)).toEqual([
      'personal.task.created',
      'personal.task.deleted',
      'personal.task.restored',
    ])
    expect(history.at(-1)).toMatchObject({
      department_id: null,
      actor_user_id: owner.id,
      after: { restoredIds: expect.arrayContaining([root.id, child.id, grandchild.id]) },
    })
    const ownList = await request(ownerSession, 'tasks')
    const listed = (await ownList.json()) as { id: string }[]
    expect(listed.some((row) => row.id === root.id)).toBe(true)
    expect(listed.some((row) => row.id === historical.id || row.id === foreign)).toBe(false)
  })

  it('keeps legacy DELETE204 and requires valid CSRF/UUID inputs with no persistence on refused writes', async () => {
    for (const kind of kinds) {
      const item = await create(kind)
      const legacy = await request(ownerSession, `${kind}/${item.id}`, 'DELETE')
      expect(legacy.status).toBe(204)
      expect(await legacy.text()).toBe('')
      const before = await itemState(kind, item.id)
      const history = await audit([item.id])
      const noCsrf = await fetch(`${server.baseUrl}/api/v1/personal/${kind}/${item.id}/restore`, {
        method: 'POST',
        headers: { cookie: ownerSession.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ restoreToken: before[0]!.deleted_operation_id }),
      })
      expect(noCsrf.status).toBe(403)
      expect((await restore(kind, item.id, 'not-a-uuid')).status).toBe(422)
      expect((await request(ownerSession, `${kind}/${item.id}?receipt=yes`, 'DELETE')).status).toBe(
        422,
      )
      expect(await itemState(kind, item.id)).toEqual(before)
      expect(await audit([item.id])).toEqual(history)
    }
  })

  it('denies foreign-owner IDs to member/head/admin and direct repository spoofing; own personal data stays own under view-as', async () => {
    const viewAs = await fetch(
      `${server.baseUrl}/api/v1/admin/departments/${departmentId}/view-as`,
      { method: 'POST', headers: adminSession.headers, body: '{}' },
    )
    expect(viewAs.status).toBe(204)
    const lensCookie = `${adminSession.cookie}; ${cookieHeader(parseCookies(viewAs.headers.getSetCookie()))}`
    const lensSession = {
      ...adminSession,
      cookie: lensCookie,
      headers: { ...adminSession.headers, cookie: lensCookie },
    }
    const restorers = { tasks: restoreTask }
    for (const kind of kinds) {
      const own = await create(kind)
      const receipt = await remove(kind, own.id)
      const before = await itemState(kind, own.id)
      const history = await audit([own.id])
      for (const foreignSession of [headSession, adminSession, lensSession]) {
        expect((await restore(kind, own.id, receipt.restoreToken, foreignSession)).status).toBe(404)
      }
      expect(await restorers[kind](owner.id, own.id, receipt.restoreToken, ctx(head))).toEqual({
        ok: 'not_found',
      })
      expect(await itemState(kind, own.id)).toEqual(before)
      expect(await audit([own.id])).toEqual(history)
      const adminOwn = await create(kind, lensSession)
      const adminReceipt = await remove(kind, adminOwn.id, lensSession)
      expect(
        (await restore(kind, adminOwn.id, adminReceipt.restoreToken, ownerSession)).status,
      ).toBe(404)
      expect(
        (await restore(kind, adminOwn.id, adminReceipt.restoreToken, lensSession)).status,
      ).toBe(200)
      expect((await itemState(kind, adminOwn.id))[0]).toMatchObject({
        user_id: admin.id,
        deleted: false,
      })
    }
  })

  it('linearizes task restore then delete, rejecting the first operation token against the later persisted deletion', async () => {
    const root = await create('tasks')
    const child = await create('tasks', ownerSession, { parentId: root.id })
    const receipt = await remove('tasks', root.id)
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    await blocker.query('begin')
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `personal.tasks:${owner.id}`,
    ])
    const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid'))
      .rows[0]!.pid
    try {
      const pendingRestore = restore('tasks', root.id, receipt.restoreToken)
      await blockedBy(blockerPid)
      const pendingDelete = request(ownerSession, `tasks/${root.id}?receipt=true`, 'DELETE')
      await blockedBy(blockerPid, 2)
      await blocker.query('commit')
      expect((await pendingRestore).status).toBe(200)
      const nextDelete = await pendingDelete
      expect(nextDelete.status).toBe(200)
      const nextReceipt = personalDeleteReceiptSchema.parse(await nextDelete.json())
      expect(nextReceipt.restoreToken).not.toBe(receipt.restoreToken)
      const before = await rows('tasks', [root.id, child.id])
      expect(
        before.every(
          (row) =>
            row.deleted &&
            row.deleted_operation_id === nextReceipt.restoreToken &&
            row.version === 4,
        ),
      ).toBe(true)
      expect((await restore('tasks', root.id, receipt.restoreToken)).status).toBe(404)
      expect(await rows('tasks', [root.id, child.id])).toEqual(before)
      expect((await restore('tasks', root.id, nextReceipt.restoreToken)).status).toBe(200)
    } finally {
      await blocker.query('rollback')
      await blocker.end()
    }
  })

  it('linearizes a later task delete before a queued old Undo without restoring the newer operation', async () => {
    const root = await create('tasks')
    const child = await create('tasks', ownerSession, { parentId: root.id })
    const oldReceipt = await remove('tasks', root.id)
    expect((await restore('tasks', root.id, oldReceipt.restoreToken)).status).toBe(200)
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    await blocker.query('begin')
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `personal.tasks:${owner.id}`,
    ])
    const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid'))
      .rows[0]!.pid
    try {
      const pendingDelete = request(ownerSession, `tasks/${root.id}?receipt=true`, 'DELETE')
      await blockedBy(blockerPid)
      const pendingRestore = restore('tasks', root.id, oldReceipt.restoreToken)
      await blockedBy(blockerPid, 2)
      await blocker.query('commit')
      const deleted = await pendingDelete
      expect(deleted.status).toBe(200)
      const newReceipt = personalDeleteReceiptSchema.parse(await deleted.json())
      expect((await pendingRestore).status).toBe(404)
      expect(
        (await rows('tasks', [root.id, child.id])).every(
          (row) =>
            row.deleted &&
            row.version === 4 &&
            row.deleted_operation_id === newReceipt.restoreToken,
        ),
      ).toBe(true)
      expect(
        (await audit([root.id])).filter((row) => row.action === 'personal.task.restored'),
      ).toHaveLength(1)
    } finally {
      await blocker.query('rollback')
      await blocker.end()
    }
  })

  it('rolls back restored subtree when its audit fails, and refuses revoked sessions without changing owner-only state', async () => {
    const root = await create('tasks')
    const child = await create('tasks', ownerSession, { parentId: root.id })
    const receipt = await remove('tasks', root.id)
    const before = await rows('tasks', [root.id, child.id])
    const history = await audit([root.id])
    await superuserQuery(
      db,
      `create function public.qa_refuse_personal_restore() returns trigger language plpgsql as $$
      begin if new.action='personal.task.restored' and new.subject_id='${root.id}' then raise exception 'QA intentional audit refusal'; end if; return new; end $$`,
    )
    await superuserQuery(
      db,
      'create trigger qa_refuse_personal_restore before insert on audit.events for each row execute function public.qa_refuse_personal_restore()',
    )
    try {
      expect((await restore('tasks', root.id, receipt.restoreToken)).status).toBe(500)
      expect(await rows('tasks', [root.id, child.id])).toEqual(before)
      expect(await audit([root.id])).toEqual(history)
    } finally {
      await superuserQuery(db, 'drop trigger qa_refuse_personal_restore on audit.events')
      await superuserQuery(db, 'drop function public.qa_refuse_personal_restore()')
    }
    expect((await restore('tasks', root.id, receipt.restoreToken)).status).toBe(200)
    const revoked = await seedBareUser(db)
    const session = await loginAs(server.baseUrl, revoked.login)
    const item = await create('tasks', session)
    const revokedReceipt = await remove('tasks', item.id, session)
    const revokedBefore = await itemState('tasks', item.id)
    const revokedAudit = await audit([item.id])
    await superuserQuery(
      db,
      "update app.sessions set revoked_at=now(),revoked_reason='qa' where user_id=$1",
      [revoked.id],
    )
    expect((await restore('tasks', item.id, revokedReceipt.restoreToken, session)).status).toBe(401)
    expect(await itemState('tasks', item.id)).toEqual(revokedBefore)
    expect(await audit([item.id])).toEqual(revokedAudit)
  })

  it('inserts directly after a nested anchor even when integer sorts and timestamps tie, without shifting other groups', async () => {
    const parent = await create('tasks', ownerSession, { sort: 99 })
    const siblings = await Promise.all(
      [0, 1, 2].map(() => create('tasks', ownerSession, { parentId: parent.id, sort: 7 })),
    )
    const siblingIds = siblings.map((item) => item.id)
    await superuserQuery(
      db,
      "update app.personal_tasks set created_at='2026-10-01T00:00:00Z' where id=any($1::uuid[])",
      [siblingIds],
    )
    const priorOrder = siblingIds.sort()
    const anchorId = priorOrder[1]!
    const unrelated = await create('tasks', ownerSession, { sort: 55 })
    const rootGroup = await create('tasks', ownerSession, { sort: 77 })
    const untouched = await rows('tasks', [parent.id, unrelated.id, rootGroup.id])
    const response = await request(ownerSession, 'tasks', 'POST', {
      title: 'New nested sibling',
      afterTaskId: anchorId,
    })
    expect(response.status).toBe(201)
    const inserted = (await response.json()) as { id: string; sort: number }
    expect(inserted).toMatchObject({
      parentId: parent.id,
      sort: 2,
      version: 1,
    })
    const ordered = await superuserQuery<{ id: string; sort: number }>(
      db,
      'select id,sort from app.personal_tasks where user_id=$1 and parent_id=$2 and deleted_at is null order by sort,created_at,id',
      [owner.id, parent.id],
    )
    expect(ordered.map((item) => item.id)).toEqual([
      priorOrder[0],
      anchorId,
      inserted.id,
      priorOrder[2],
    ])
    expect(ordered.map((item) => item.sort)).toEqual([0, 1, 2, 3])
    expect(await rows('tasks', [parent.id, unrelated.id, rootGroup.id])).toEqual(untouched)
    const listing = await request(ownerSession, 'tasks')
    const listed = (await listing.json()) as { id: string; parentId: string }[]
    expect(listed.filter((item) => item.parentId === parent.id).map((item) => item.id)).toEqual(
      ordered.map((item) => item.id),
    )
    expect((await audit([inserted.id])).map((item) => item.action)).toEqual([
      'personal.task.created',
    ])
    expect(
      await superuserQuery(
        db,
        "select after from audit.events where actor_user_id=$1 and action='personal.task.reordered' and after->>'reason'='insert_after' order by at desc limit 1",
        [owner.id],
      ),
    ).toEqual([{ after: { count: 3, reason: 'insert_after' } }])
  })

  it('rejects foreign/deleted/broken anchors and untrusted placement combinations without task or audit effects', async () => {
    const anchor = await create('tasks')
    const deleted = await create('tasks')
    await remove('tasks', deleted.id)
    const foreign = await create('tasks', headSession)
    const brokenParent = await create('tasks')
    await superuserQuery(db, 'update app.personal_tasks set parent_id=$1 where id=$2', [
      foreign.id,
      brokenParent.id,
    ])
    async function allEffects() {
      return {
        tasks: await superuserQuery(
          db,
          'select id,parent_id,sort,version,deleted_operation_id from app.personal_tasks order by id',
        ),
        audit: await superuserQuery(db, 'select id from audit.events order by seq'),
      }
    }
    const before = await allEffects()
    const inputs = [
      { afterTaskId: randomUUID() },
      { afterTaskId: foreign.id },
      { afterTaskId: deleted.id },
      { afterTaskId: brokenParent.id },
      { afterTaskId: anchor.id, parentId: null },
      { afterTaskId: anchor.id, sort: 0 },
      { afterTaskId: 'invalid' },
    ]
    const responses = await Promise.all(
      inputs.map((input) =>
        request(ownerSession, 'tasks', 'POST', { title: 'Refuse unsafe insertion', ...input }),
      ),
    )
    expect(responses.map((response) => response.status)).toEqual(inputs.map(() => 422))
    expect(await allEffects()).toEqual(before)
  })

  it('serializes two same-anchor inserts and preserves unique sibling positions', async () => {
    const parent = await create('tasks')
    const anchor = await create('tasks', ownerSession, { parentId: parent.id })
    const tail = await create('tasks', ownerSession, { parentId: parent.id })
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    await blocker.query('begin')
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      `personal.tasks:${owner.id}`,
    ])
    const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid'))
      .rows[0]!.pid
    try {
      const first = request(ownerSession, 'tasks', 'POST', {
        title: 'First insertion',
        afterTaskId: anchor.id,
      })
      await blockedBy(blockerPid)
      const second = request(ownerSession, 'tasks', 'POST', {
        title: 'Second insertion',
        afterTaskId: anchor.id,
      })
      await blockedBy(blockerPid, 2)
      await blocker.query('commit')
      const responses = await Promise.all([first, second])
      expect(responses.map((response) => response.status)).toEqual([201, 201])
      const [firstItem, secondItem] = await Promise.all(
        responses.map((response) => response.json() as Promise<{ id: string }>),
      )
      const ordered = await superuserQuery<{ id: string; sort: number }>(
        db,
        'select id,sort from app.personal_tasks where parent_id=$1 and user_id=$2 and deleted_at is null order by sort,created_at,id',
        [parent.id, owner.id],
      )
      expect(ordered.map((item) => item.id)).toEqual([
        anchor.id,
        secondItem!.id,
        firstItem!.id,
        tail.id,
      ])
      expect(ordered.map((item) => item.sort)).toEqual([0, 1, 2, 3])
    } finally {
      await blocker.query('rollback')
      await blocker.end()
    }
  })

  it.each(['delete-first', 'insert-first'] as const)(
    'serializes nested insertion versus ancestor deletion: %s',
    async (order) => {
      const parent = await create('tasks')
      const anchor = await create('tasks', ownerSession, { parentId: parent.id })
      const blocker = new Client({ connectionString: db.superuserUrl })
      await blocker.connect()
      await blocker.query('begin')
      await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
        `personal.tasks:${owner.id}`,
      ])
      const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid'))
        .rows[0]!.pid
      const insert = () =>
        request(ownerSession, 'tasks', 'POST', {
          title: 'Concurrent nested sibling',
          afterTaskId: anchor.id,
        })
      const deletion = () => request(ownerSession, `tasks/${parent.id}?receipt=true`, 'DELETE')
      try {
        const first = order === 'delete-first' ? deletion() : insert()
        await blockedBy(blockerPid)
        const second = order === 'delete-first' ? insert() : deletion()
        await blockedBy(blockerPid, 2)
        await blocker.query('commit')
        const [firstResponse, secondResponse] = await Promise.all([first, second])
        const deleted = order === 'delete-first' ? firstResponse : secondResponse
        const inserted = order === 'delete-first' ? secondResponse : firstResponse
        expect(deleted.status).toBe(200)
        const receipt = personalDeleteReceiptSchema.parse(await deleted.json())
        expect(inserted.status).toBe(order === 'delete-first' ? 422 : 201)
        const ids = [parent.id, anchor.id]
        if (order === 'insert-first') ids.push(((await inserted.json()) as ItemSnapshot).id)
        expect(
          (await rows('tasks', ids)).every(
            (row) => row.deleted && row.deleted_operation_id === receipt.restoreToken,
          ),
        ).toBe(true)
      } finally {
        await blocker.query('rollback')
        await blocker.end()
      }
    },
  )
})

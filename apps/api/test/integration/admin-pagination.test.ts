import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAuditExportSnapshot, listAuditEvents } from '../../src/modules/admin/repo.js'
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
let db: Db
let server: Server
let admin: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const owner = await seedBareUser(db, { instanceRole: 'super_admin' })
  admin = await loginAs(server.baseUrl, owner.login)
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})
function get(path: string) {
  const headers = { ...admin.headers }
  delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/admin/${path}`, { headers })
}
function post(path: string, body?: unknown) {
  const headers = { ...admin.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1/admin/${path}`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function blockedBy(pid: number, count = 1) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiters = await superuserQuery(
      db,
      `with recursive waiting as (
      select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))
      union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
    ) select pid from waiting`,
      [pid],
    )
    if (waiters.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected actual department status lock waiters')
}
describe('admin list pagination boundaries', () => {
  it('validates audit dates and retains existing date-only request compatibility', async () => {
    for (const route of ['audit/events', 'audit/export']) {
      for (const field of ['from', 'to'])
        expect.soft((await get(`${route}?${field}=not-a-date`)).status).toBe(422)
      expect.soft((await get(`${route}?from=2026-10-01&to=2026-10-31`)).status).toBe(200)
    }
  })
  it('bounds export counts and freezes the matching high-water mark across later audit appends', async () => {
    const actor = await seedBareUser(db)
    await loginAs(server.baseUrl, actor.login)
    const filters = { actorUserId: actor.id }
    const initial = await getAuditExportSnapshot(filters, 200_000)
    expect(initial.count).toBeGreaterThan(0)
    expect(initial.throughSeq).not.toBeNull()
    await loginAs(server.baseUrl, actor.login)
    const current = await getAuditExportSnapshot(filters, 200_000)
    expect(current.count).toBeGreaterThan(initial.count)
    const frozen = await listAuditEvents({
      ...filters,
      throughSeq: initial.throughSeq!,
      limit: 100,
    })
    expect(frozen.rows).toHaveLength(initial.count)
    expect(frozen.rows.every((row) => row.seq <= initial.throughSeq!)).toBe(true)
    const bounded = await getAuditExportSnapshot(filters, 0)
    expect(bounded.count).toBe(1)
  })
  it('advances join-decision revisions with account state transitions and preserves ordinary/head reset support', async () => {
    const department = await seedDepartment(db, {
      name: 'Admin member revision',
      slug: `member-revision-${randomUUID()}`,
    })
    for (const role of ['member', 'head'] as const) {
      const actor = await seedMember(db, department.id, { role })
      const active = await loginAs(server.baseUrl, actor.login)
      const version = async () =>
        Number(
          (
            await superuserQuery<{ version: number }>(
              db,
              'select version from app.memberships where user_id=$1',
              [actor.id],
            )
          )[0]!.version,
        )
      const initial = await version()
      expect(
        (await post(`accounts/${actor.id}/lock`, { reason: 'Synthetic revision fixture' })).status,
      ).toBe(204)
      expect(await version()).toBe(initial + 1)
      expect((await post(`accounts/${actor.id}/unlock`)).status).toBe(204)
      expect(await version()).toBe(initial + 2)
      const headers = { ...admin.headers }
      delete headers['content-type']
      const reset = await fetch(`${server.baseUrl}/api/v1/accounts/${actor.id}/reset-password`, {
        method: 'POST',
        headers,
      })
      expect(reset.status).toBe(200)
      const { temporaryPassword } = (await reset.json()) as { temporaryPassword: string }
      expect(temporaryPassword.length).toBeGreaterThan(16)
      const oldHeaders = { ...active.headers }
      delete oldHeaders['content-type']
      expect((await fetch(`${server.baseUrl}/api/v1/me`, { headers: oldHeaders })).status).toBe(401)
      expect(
        (await loginAs(server.baseUrl, actor.login, temporaryPassword)).cookie.length,
      ).toBeGreaterThan(0)
      expect(await version()).toBe(initial + 2)
      expect((await post(`accounts/${actor.id}/anonymize`)).status).toBe(204)
      expect(await version()).toBe(initial + 3)
    }
  })
  it('refuses missing, deleted and protected password-reset targets without minted credentials or side effects', async () => {
    const protectedUser = await seedBareUser(db, { instanceRole: 'super_admin' })
    const deleted = await seedBareUser(db)
    await superuserQuery(db, "update app.users set status='deleted',deleted_at=now() where id=$1", [
      deleted.id,
    ])
    for (const id of [randomUUID(), deleted.id, protectedUser.id]) {
      const before = {
        users: await superuserQuery(
          db,
          'select id,status,password_hash,must_change_password from app.users where id=$1',
          [id],
        ),
        audits: await superuserQuery(db, 'select id from audit.events where subject_id=$1', [id]),
      }
      const headers = { ...admin.headers }
      delete headers['content-type']
      const response = await fetch(`${server.baseUrl}/api/v1/accounts/${id}/reset-password`, {
        method: 'POST',
        headers,
      })
      expect.soft(response.status).toBe(404)
      expect.soft(await response.json()).not.toHaveProperty('temporaryPassword')
      expect
        .soft({
          users: await superuserQuery(
            db,
            'select id,status,password_hash,must_change_password from app.users where id=$1',
            [id],
          ),
          audits: await superuserQuery(db, 'select id from audit.events where subject_id=$1', [id]),
        })
        .toEqual(before)
    }
  })
  it.each(['lock', 'anonymize', 'force-2fa-reset'] as const)(
    'protects admin accounts from hidden destructive menu actions: %s',
    async (action) => {
      const target = await seedBareUser(db, { instanceRole: 'super_admin' })
      const before = {
        user: await superuserQuery(
          db,
          'select id,login,status,password_hash,deleted_at from app.users where id=$1',
          [target.id],
        ),
        security: await superuserQuery(db, 'select * from app.user_security where user_id=$1', [
          target.id,
        ]),
        audit: await superuserQuery(db, 'select id from audit.events where subject_id=$1', [
          target.id,
        ]),
      }
      const response = await post(
        `accounts/${target.id}/${action}`,
        action === 'lock' ? { reason: 'Synthetic protected target' } : undefined,
      )
      expect.soft(response.status).toBe(404)
      expect
        .soft({
          user: await superuserQuery(
            db,
            'select id,login,status,password_hash,deleted_at from app.users where id=$1',
            [target.id],
          ),
          security: await superuserQuery(db, 'select * from app.user_security where user_id=$1', [
            target.id,
          ]),
          audit: await superuserQuery(db, 'select id from audit.events where subject_id=$1', [
            target.id,
          ]),
        })
        .toEqual(before)
    },
  )
  it('refuses nonexistent or deleted2FA reset targets without fabricated success or audit', async () => {
    const deleted = await seedBareUser(db)
    await superuserQuery(db, "update app.users set status='deleted',deleted_at=now() where id=$1", [
      deleted.id,
    ])
    for (const id of [randomUUID(), deleted.id]) {
      expect.soft((await post(`accounts/${id}/force-2fa-reset`)).status).toBe(404)
      expect
        .soft(await superuserQuery(db, 'select * from app.user_security where user_id=$1', [id]))
        .toEqual([])
      expect
        .soft(await superuserQuery(db, 'select * from audit.events where subject_id=$1', [id]))
        .toEqual([])
    }
  })
  it('reads department AI metering under a signed admin lens while keeping member-own and no-lens boundaries', async () => {
    const department = await seedDepartment(db, {
      name: 'AI ledger scope',
      slug: `ai-ledger-${randomUUID()}`,
    })
    const head = await seedMember(db, department.id, { role: 'head' })
    const member = await seedMember(db, department.id, { role: 'member' })
    const foreignDept = await seedDepartment(db, {
      name: 'Foreign AI ledger',
      slug: `ai-foreign-${randomUUID()}`,
    })
    const foreign = await seedMember(db, foreignDept.id, { role: 'member' })
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    for (const [index, row] of [head, member, foreign].entries())
      await superuserQuery(
        db,
        "insert into app.ai_traces(id,department_id,user_id,feature,model,status) values($1,$2,$3,'quick_add_parse','local-fixture','ok')",
        [ids[index], index === 2 ? foreignDept.id : department.id, row.id],
      )
    async function usage(actor: Session) {
      const headers = { ...actor.headers }
      delete headers['content-type']
      return fetch(`${server.baseUrl}/api/v1/ai/usage`, { headers })
    }
    const memberUsage = await usage(await loginAs(server.baseUrl, member.login))
    expect(memberUsage.status).toBe(200)
    expect(
      ((await memberUsage.json()) as { traces: { id: string }[] }).traces.map((row) => row.id),
    ).toEqual([ids[1]])
    expect((await usage(admin)).status).toBe(403)
    const start = await post(`departments/${department.id}/view-as`, {})
    expect(start.status).toBe(204)
    const viewCookie = start.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
    const lens = {
      ...admin,
      headers: { ...admin.headers, cookie: `${admin.cookie}; ${viewCookie}` },
    }
    const response = await usage(lens)
    expect(response.status).toBe(200)
    expect(
      ((await response.json()) as { traces: { id: string }[] }).traces.map((row) => row.id).sort(),
    ).toEqual(ids.slice(0, 2).sort())
  })
  it('records the actual committed status before each concurrent department action', async () => {
    const department = await seedDepartment(db, {
      name: 'Concurrent admin',
      slug: `concurrent-${randomUUID()}`,
    })
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    await blocker.query('begin')
    await blocker.query('select id from app.departments where id=$1 for update', [department.id])
    const pid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!
      .pid
    try {
      const pause = post(`departments/${department.id}/pause`, {
        reason: 'Local concurrency fixture',
      })
      await blockedBy(pid)
      const archive = post(`departments/${department.id}/archive`)
      await blockedBy(pid, 2)
      await blocker.query('commit')
      expect((await Promise.all([pause, archive])).map((response) => response.status)).toEqual([
        204, 204,
      ])
      const events = await superuserQuery(
        db,
        "select action,before,after from audit.events where subject_id=$1 and action like 'admin.department.%' order by seq",
        [department.id],
      )
      expect(events).toEqual([
        {
          action: 'admin.department.paused',
          before: { status: 'active' },
          after: { status: 'paused_by_admin', reason: 'Local concurrency fixture' },
        },
        {
          action: 'admin.department.archived',
          before: { status: 'paused_by_admin' },
          after: { status: 'archived' },
        },
      ])
    } finally {
      await blocker.query('rollback')
      await blocker.end()
    }
  })
  it('exports user-controlled actor names as literal spreadsheet cells', async () => {
    const row = await seedBareUser(db)
    await superuserQuery(db, "update app.users set given_name='=1+1',family_name='' where id=$1", [
      row.id,
    ])
    const actor = await loginAs(server.baseUrl, row.login)
    const response = await get(`audit/export?actorUserId=${row.id}`)
    expect(response.status).toBe(200)
    const csv = await response.text()
    expect(csv).toContain('"\'=1+1"')
    expect(csv).not.toContain(',"=1+1",')
    expect(actor.cookie.length).toBeGreaterThan(0)
  })
  it.each(['accounts', 'departments'] as const)(
    'retains existing millisecond cursor compatibility: %s',
    async (kind) => {
      const prefix = `qa-legacy-${randomUUID().slice(0, 8)}`
      const row =
        kind === 'accounts'
          ? await seedBareUser(db, { login: prefix })
          : await seedDepartment(db, { name: prefix, slug: prefix })
      await superuserQuery(
        db,
        `update app.${kind === 'accounts' ? 'users' : 'departments'} set created_at='2026-10-08T00:00:00.000Z' where id=$1`,
        [row.id],
      )
      const cursor = `2026-10-08T00:00:00.000Z|${row.id}`
      const response = await get(`${kind}?query=${prefix}&cursor=${encodeURIComponent(cursor)}`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        users?: unknown[]
        departments?: unknown[]
        nextCursor: string | null
      }
      expect(body.users ?? body.departments).toEqual([])
      expect(body.nextCursor).toBeNull()
    },
  )
  it.each(['accounts', 'departments'] as const)(
    'does not lose rows at identical microsecond timestamps: %s',
    async (kind) => {
      const prefix = `qa-page-${randomUUID().slice(0, 8)}`
      const ids: string[] = []
      for (let index = 0; index < 3; index++) {
        const row =
          kind === 'accounts'
            ? await seedBareUser(db, { login: `${prefix}-${index}` })
            : await seedDepartment(db, { name: `${prefix}-${index}`, slug: `${prefix}-${index}` })
        ids.push(row.id)
      }
      await superuserQuery(
        db,
        `update app.${kind === 'accounts' ? 'users' : 'departments'} set created_at='2026-10-08T00:00:00.123456Z' where id=any($1::uuid[])`,
        [ids],
      )
      const seen: string[] = []
      let cursor: string | null = null
      for (let page = 0; page < 4; page++) {
        const qs = new URLSearchParams({ query: prefix, limit: '1', status: 'active' })
        if (cursor) qs.set('cursor', cursor)
        const response = await get(`${kind}?${qs}`)
        expect(response.status).toBe(200)
        const data = (await response.json()) as {
          users?: { id: string }[]
          departments?: { id: string }[]
          nextCursor: string | null
        }
        seen.push(...(data.users ?? data.departments ?? []).map((row) => row.id))
        cursor = data.nextCursor
        if (cursor === null) break
      }
      expect(seen).toEqual(ids.sort().reverse())
    },
  )
  it.each(['accounts', 'departments'] as const)(
    'rejects malformed cursor safely rather than ignoring it or returning500: %s',
    async (kind) => {
      for (const cursor of [
        'garbage',
        `bad-date|${randomUUID()}`,
        '2026-10-08T00:00:00.000Z|not-a-uuid',
      ]) {
        expect.soft((await get(`${kind}?cursor=${encodeURIComponent(cursor)}`)).status).toBe(422)
      }
    },
  )
})

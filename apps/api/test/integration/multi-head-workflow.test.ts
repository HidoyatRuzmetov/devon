import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import {
  assertUserCanBeDisabled,
  DepartmentMembershipChangedError,
  LastDepartmentHeadError,
  lockUserDepartments,
} from '../../src/lib/department-heads.js'
import { hashPassword } from '../../src/lib/password.js'
import {
  lockUser,
  anonymizeUser,
  listDepartments as adminListDepartments,
  getDepartmentDetail as adminDepartmentDetail,
} from '../../src/modules/admin/repo.js'
import { headUserId } from '../../src/modules/ai/repo.js'
import {
  joinByKeyAndPassword,
  leaveDepartment,
  removeMember,
  resetMemberPassword,
  rotateJoinKey,
  rotateJoinPassword,
  setMemberRole,
  setJoinApproval,
  transferHeadship,
  updateDepartmentSettings,
  updateFeatures,
  getDepartmentDetail,
} from '../../src/modules/departments/repo.js'
import type { AuditCtx } from '../../src/types.js'
import {
  loginAs,
  PASSWORD,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'

let db: Db
let server: Server
let passwordHash: string
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  passwordHash = await hashPassword(PASSWORD)
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

const context = (userId: string): AuditCtx => ({
  requestId: randomUUID(),
  userId,
  actorRole: 'member',
  actingForUserId: null,
  ip: '127.0.0.1',
  userAgent: 'multi-head integration',
})

async function fixture(secondHead = false) {
  const department = await seedDepartment(db, { name: 'Multi-head QA', slug: randomUUID() })
  const first = await seedMember(db, department.id, { role: 'head', passwordHash })
  const second = await seedMember(db, department.id, {
    role: secondHead ? 'head' : 'member',
    passwordHash,
  })
  const third = await seedMember(db, department.id, { role: 'member', passwordHash })
  return { department, first, second, third, ctx: context(first.id) }
}

async function activeHeads(departmentId: string) {
  return superuserQuery<{ user_id: string }>(
    db,
    `select m.user_id from app.memberships m
    join app.users u on u.id=m.user_id where m.department_id=$1 and m.role='head'
    and m.status='active' and m.deleted_at is null and u.status='active' and u.deleted_at is null
    order by m.user_id`,
    [departmentId],
  )
}

describe('multiple department heads', () => {
  it('retries account administration if a new department appeared while its leadership locks were acquired', async () => {
    const f = await fixture(true)
    const other = await seedDepartment(db, { name: 'Concurrent join', slug: randomUUID() })
    await expect(
      withContext(
        { ...f.ctx, actorRole: 'super_admin', departmentId: null, viewAs: false },
        async (tx) => {
          const locked = await lockUserDepartments(tx, f.first.id)
          await superuserQuery(
            db,
            `insert into app.memberships (department_id,user_id,role,status) values ($1,$2,'head','active')`,
            [other.id, f.first.id],
          )
          await tx.raw(sql`select id from app.users where id=${f.first.id} for update`)
          await assertUserCanBeDisabled(tx, f.first.id, locked)
        },
      ),
    ).rejects.toBeInstanceOf(DepartmentMembershipChangedError)
    expect(await activeHeads(other.id)).toHaveLength(1)
  })
  it('lists every active head in admin summaries, excluding locked accounts', async () => {
    const f = await fixture(true)
    await superuserQuery(
      db,
      `update app.users set given_name='Anvar',family_name='Aliyev' where id=$1`,
      [f.first.id],
    )
    await superuserQuery(
      db,
      `update app.users set given_name='Nodira',family_name='Karimova' where id=$1`,
      [f.second.id],
    )
    const list = await adminListDepartments({ query: 'Multi-head QA', limit: 100 })
    const detail = await adminDepartmentDetail(f.department.id)
    expect(list.rows.find((row) => row.id === f.department.id)?.headName).toContain('Anvar Aliyev')
    expect(detail?.headName).toContain('Nodira Karimova')
    await superuserQuery(db, `update app.users set status='locked' where id=$1`, [f.second.id])
    expect((await adminDepartmentDetail(f.department.id))?.headName).toBe('Anvar Aliyev')
  })
  it('merges concurrent settings and capability edits from different heads', async () => {
    const f = await fixture(true)
    await Promise.all([
      updateDepartmentSettings(f.department.id, f.first.id, { allowSelfAssign: false }, f.ctx),
      updateDepartmentSettings(
        f.department.id,
        f.second.id,
        { allowStructureEdit: false },
        context(f.second.id),
      ),
      updateFeatures(f.department.id, { estimates: false }, f.ctx),
      updateFeatures(f.department.id, { templates: false }, context(f.second.id)),
    ])
    const detail = await getDepartmentDetail(f.department.id, f.first.id, 'head')
    expect(detail?.settings).toMatchObject({ allowSelfAssign: false, allowStructureEdit: false })
    expect(detail?.features).toMatchObject({ estimates: false, templates: false })
  })
  it('appoints a second head without replacing the first, and refreshes authorization in the same session', async () => {
    const f = await fixture()
    const firstSession = await loginAs(server.baseUrl, f.first.login)
    const secondSession = await loginAs(server.baseUrl, f.second.login)
    const managed = `${server.baseUrl}/api/v1/departments/${f.department.id}/join-requests`
    expect((await fetch(managed, { headers: secondSession.headers })).status).toBe(403)
    const url = `${server.baseUrl}/api/v1/departments/${f.department.id}/members/${f.second.id}/role`
    expect(
      (
        await fetch(url, {
          method: 'PATCH',
          headers: secondSession.headers,
          body: JSON.stringify({ role: 'head', expectedVersion: 1 }),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(url, {
          method: 'PATCH',
          headers: firstSession.headers,
          body: JSON.stringify({ role: 'head', expectedVersion: 1 }),
        })
      ).status,
    ).toBe(204)
    expect((await activeHeads(f.department.id)).map((row) => row.user_id).sort()).toEqual(
      [f.first.id, f.second.id].sort(),
    )
    expect((await fetch(managed, { headers: secondSession.headers })).status).toBe(200)
    expect((await fetch(managed, { headers: firstSession.headers })).status).toBe(200)
    expect(
      (
        await fetch(url, {
          method: 'PATCH',
          headers: firstSession.headers,
          body: JSON.stringify({ role: 'member', expectedVersion: 2 }),
        })
      ).status,
    ).toBe(204)
    expect((await fetch(managed, { headers: secondSession.headers })).status).toBe(403)
    const events = await superuserQuery(
      db,
      `select payload->>'role' as role from app.outbox_events
      where department_id=$1 and type='departments.membership.changed' order by created_at`,
      [f.department.id],
    )
    expect(events).toEqual([{ role: 'head' }, { role: 'member' }])
    const audits = await superuserQuery(
      db,
      `select action from audit.events where department_id=$1
      and action='departments.member_role_changed'`,
      [f.department.id],
    )
    expect(audits).toHaveLength(2)
  })

  it('requires CSRF, rejects stale role versions, and cannot appoint a pending, removed, locked or foreign member', async () => {
    const f = await fixture()
    const session = await loginAs(server.baseUrl, f.first.login)
    const url = `${server.baseUrl}/api/v1/departments/${f.department.id}/members/${f.second.id}/role`
    expect(
      (
        await fetch(url, {
          method: 'PATCH',
          headers: { cookie: session.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'head', expectedVersion: 1 }),
        })
      ).status,
    ).toBe(403)
    expect(await setMemberRole(f.department.id, f.second.id, 'head', 999, f.ctx)).toBe(false)
    // Each assertion reads the same membership after the preceding status change.
    for (const status of ['pending_approval', 'removed']) {
      // eslint-disable-next-line no-restricted-syntax -- Dependent transitions of one row must be sequential.
      await superuserQuery(db, 'update app.memberships set status=$1 where user_id=$2', [
        status,
        f.second.id,
      ])
      expect(await setMemberRole(f.department.id, f.second.id, 'head', 1, f.ctx)).toBe(false)
    }
    await superuserQuery(db, "update app.memberships set status='active' where user_id=$1", [
      f.second.id,
    ])
    await superuserQuery(db, "update app.users set status='locked' where id=$1", [f.second.id])
    expect(await setMemberRole(f.department.id, f.second.id, 'head', 1, f.ctx)).toBe(false)
    const foreign = await fixture()
    expect(await setMemberRole(f.department.id, foreign.second.id, 'head', 1, f.ctx)).toBe(false)
    expect(await setMemberRole(f.department.id, f.third.id, 'head', 1, context(f.second.id))).toBe(
      false,
    )
    expect(await activeHeads(f.department.id)).toHaveLength(1)
  })

  it('lets either head appoint another head, step down or leave while another remains', async () => {
    const f = await fixture(true)
    expect(await setMemberRole(f.department.id, f.third.id, 'head', 1, context(f.second.id))).toBe(
      true,
    )
    expect(await setMemberRole(f.department.id, f.first.id, 'member', 1, f.ctx)).toBe(true)
    expect(await leaveDepartment(f.department.id, f.second.id, context(f.second.id))).toEqual({
      ok: true,
    })
    expect(await activeHeads(f.department.id)).toEqual([{ user_id: f.third.id }])
    expect(await leaveDepartment(f.department.id, f.third.id, context(f.third.id))).toEqual({
      ok: false,
      reason: 'is_only_head',
    })
    await expect(
      setMemberRole(f.department.id, f.third.id, 'member', 2, context(f.third.id)),
    ).rejects.toBeInstanceOf(LastDepartmentHeadError)
  })

  it('serializes simultaneous self-demotions so a department keeps one active head', async () => {
    const f = await fixture(true)
    const results = await Promise.allSettled([
      setMemberRole(f.department.id, f.first.id, 'member', 1, f.ctx),
      setMemberRole(f.department.id, f.second.id, 'member', 1, context(f.second.id)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled' && r.value === true)).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(await activeHeads(f.department.id)).toHaveLength(1)
  })

  it('serializes simultaneous departures and prevents one departing head from removing the survivor', async () => {
    const f = await fixture(true)
    const results = await Promise.all([
      leaveDepartment(f.department.id, f.first.id, f.ctx),
      leaveDepartment(f.department.id, f.second.id, context(f.second.id)),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const [survivor] = await activeHeads(f.department.id)
    const departedId = survivor!.user_id === f.first.id ? f.second.id : f.first.id
    expect(await removeMember(f.department.id, survivor!.user_id, context(departedId))).toBe(false)
    expect(await activeHeads(f.department.id)).toHaveLength(1)
  })

  it('serializes opposing demotions and rejects a stale head actor', async () => {
    const f = await fixture(true)
    const results = await Promise.all([
      setMemberRole(f.department.id, f.second.id, 'member', 1, f.ctx),
      setMemberRole(f.department.id, f.first.id, 'member', 1, context(f.second.id)),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await activeHeads(f.department.id)).toHaveLength(1)
  })

  it('transfers only the acting head role, retaining other heads and their permissions', async () => {
    const f = await fixture(true)
    expect(await transferHeadship(f.department.id, f.first.id, f.third.id, f.ctx)).toBe(true)
    expect((await activeHeads(f.department.id)).map((row) => row.user_id).sort()).toEqual(
      [f.second.id, f.third.id].sort(),
    )
    expect(await setMemberRole(f.department.id, f.first.id, 'head', 2, context(f.second.id))).toBe(
      true,
    )
  })

  it.each([true, false])(
    'rejoining a removed head respects approval=%s and never restores leadership',
    async (approval) => {
      const f = await fixture(true)
      await setJoinApproval(f.department.id, approval, f.ctx)
      const invite = await rotateJoinKey(f.department.id, f.ctx)
      const secret = await rotateJoinPassword(f.department.id, f.ctx)
      expect(await removeMember(f.department.id, f.second.id, f.ctx)).toBe(true)
      expect(
        (await joinByKeyAndPassword(f.second.id, invite, secret.password, context(f.second.id))).ok,
      ).toBe(true)
      const [membership] = await superuserQuery(
        db,
        'select role,status from app.memberships where department_id=$1 and user_id=$2',
        [f.department.id, f.second.id],
      )
      expect(membership).toEqual({
        role: 'member',
        status: approval ? 'pending_approval' : 'active',
      })
    },
  )

  it('keeps co-head passwords protected and refuses to disable the last eligible head', async () => {
    const f = await fixture(true)
    expect(await resetMemberPassword(f.department.id, f.second.id, f.first.id, f.ctx)).toEqual({
      ok: false,
      reason: 'is_head',
    })
    expect(await lockUser(f.second.id, 'QA lock', { ...f.ctx, actorRole: 'super_admin' })).toBe(
      true,
    )
    await expect(
      lockUser(f.first.id, 'QA lock', { ...f.ctx, actorRole: 'super_admin' }),
    ).rejects.toBeInstanceOf(LastDepartmentHeadError)
    await expect(
      anonymizeUser(f.first.id, { ...f.ctx, actorRole: 'super_admin' }),
    ).rejects.toBeInstanceOf(LastDepartmentHeadError)
    expect(await leaveDepartment(f.department.id, f.first.id, f.ctx)).toEqual({
      ok: false,
      reason: 'is_only_head',
    })
    expect(await setMemberRole(f.department.id, f.second.id, 'member', 2, f.ctx)).toBe(true)
  })

  it('attributes a manual briefing to the requesting head and excludes inactive heads', async () => {
    const f = await fixture(true)
    const read = (requestedBy: string | null) =>
      withContext(
        {
          ...f.ctx,
          departmentId: f.department.id,
          departmentRole: 'head',
          actorRole: 'super_admin',
          viewAs: false,
        },
        (tx) => headUserId(tx, f.department.id, requestedBy),
      )
    expect(await read(f.second.id)).toBe(f.second.id)
    expect(await read(f.third.id)).toBeNull()
    await lockUser(f.first.id, 'QA lock', { ...f.ctx, actorRole: 'super_admin' })
    expect(await read(null)).toBe(f.second.id)
    expect(await read(f.first.id)).toBeNull()
  })
})

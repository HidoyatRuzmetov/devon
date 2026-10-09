import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as passwords from '../../src/lib/password.js'
import {
  resetMemberPassword,
  removeMember,
  transferHeadship,
  leaveDepartment,
} from '../../src/modules/departments/repo.js'
import type { AuditCtx } from '../../src/types.js'
import {
  PASSWORD,
  loginAs,
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
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})

async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Password eligibility QA',
    slug: randomUUID(),
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const target = await seedMember(db, department.id, { role: 'member' })
  const session = await loginAs(server.baseUrl, target.login)
  const ctx: AuditCtx = {
    requestId: randomUUID(),
    userId: head.id,
    actorRole: 'head',
    actingForUserId: null,
    ip: '127.0.0.1',
    userAgent: 'local password eligibility QA',
  }
  return { department, head, target, session, ctx }
}

async function securitySnapshot(userId: string) {
  const [row] = await superuserQuery<{
    password_hash: string
    must_change_password: boolean
    active_sessions: string
    reset_audits: string
    reset_events: string
  }>(
    db,
    `select password_hash, must_change_password,
    (select count(*) from app.sessions where user_id=u.id and revoked_at is null) active_sessions,
    (select count(*) from audit.events where subject_id=u.id::text
      and action='accounts.password_reset_by_head') reset_audits,
    (select count(*) from app.outbox_events where payload->>'userId'=u.id::text
      and type='accounts.password.reset_by_head') reset_events
    from app.users u where id=$1`,
    [userId],
  )
  return {
    oldPasswordWorks: await passwords.verifyPassword(row!.password_hash, PASSWORD),
    mustChange: row!.must_change_password,
    activeSessions: Number(row!.active_sessions),
    resetAudits: Number(row!.reset_audits),
    resetEvents: Number(row!.reset_events),
  }
}

async function orderedFixture(headFirst: boolean) {
  const department = await seedDepartment(db, {
    name: 'Password lock ordering QA',
    slug: randomUUID(),
  })
  const suffix = randomUUID().slice(1)
  const headId = `${headFirst ? '0' : 'f'}${suffix}`
  const targetId = `${headFirst ? 'f' : '0'}${suffix}`
  const passwordHash = await passwords.hashPassword(PASSWORD)
  await superuserQuery(
    db,
    `insert into app.users (id,login,password_hash,given_name,family_name,role)
    values ($1,$2,$3,'Synthetic','Head','member'), ($4,$5,$3,'Synthetic','Member','member');`,
    [headId, `order.head.${randomUUID()}`, passwordHash, targetId, `order.member.${randomUUID()}`],
  )
  await superuserQuery(
    db,
    `insert into app.memberships (id,department_id,user_id,role)
    values ($1,$2,$3,'head'), ($4,$2,$5,'member')`,
    [randomUUID(), department.id, headId, randomUUID(), targetId],
  )
  const ctx: AuditCtx = {
    requestId: randomUUID(),
    userId: headId,
    actorRole: 'head',
    actingForUserId: null,
    ip: '127.0.0.1',
    userAgent: 'local membership lock QA',
  }
  return { department, headId, targetId, ctx }
}

async function waitForMembershipWaiters(blockerPid: number, count: number) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const rows = await superuserQuery(
      db,
      `select pid from pg_stat_activity
      where datname=current_database() and wait_event_type='Lock'
        and (query ilike '%memberships%' or query ilike '%app.users%')
        and cardinality(pg_blocking_pids(pid)) > 0
        and pid <> $1`,
      [blockerPid],
    )
    if (rows.length >= count) return
    await delay(25)
  }
  throw new Error(`Actual membership lock waiters did not reach ${count}`)
}

describe('head password-reset eligibility stays current across hashing', () => {
  it('orders membership locks compatibly with an actual concurrent headship transfer', async () => {
    const { department, headId, targetId, ctx } = await orderedFixture(false)
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    let settled: Promise<PromiseSettledResult<unknown>[]> | undefined
    try {
      await blocker.query('begin')
      await blocker.query(
        `select id from app.memberships where department_id=$1 and user_id=$2 for update`,
        [department.id, headId],
      )
      const {
        rows: [backend],
      } = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
      const transfer = transferHeadship(department.id, headId, targetId, ctx)
      // Observe the actual transfer waiting on the held head row before starting the reset.
      const transferHandled = transfer.then((value) => value)
      void transferHandled.catch(() => undefined)
      await waitForMembershipWaiters(backend!.pid, 1)
      const reset = resetMemberPassword(department.id, targetId, headId, ctx)
      settled = Promise.allSettled([transferHandled, reset])
      await waitForMembershipWaiters(backend!.pid, 2)
      await blocker.query('commit')
      const outcomes = await settled
      // Only expose success/error state, never a temporary password in assertion output.
      expect(
        outcomes
          .filter((outcome) => outcome.status === 'rejected')
          .map((outcome) => {
            const cause = outcome.reason as {
              code?: string
              message?: string
              cause?: { code?: string; message?: string }
            }
            return {
              code: cause.code ?? cause.cause?.code,
              message: cause.message,
              causeMessage: cause.cause?.message,
            }
          }),
      ).toEqual([])
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
      const transferred = outcomes[0] as PromiseFulfilledResult<boolean>
      const resetResult = outcomes[1] as PromiseFulfilledResult<{ ok: boolean }>
      expect(transferred.value).toBe(true)
      expect(resetResult.value.ok).toBe(false)
      const [target] = await superuserQuery<{ password_hash: string }>(
        db,
        'select password_hash from app.users where id=$1',
        [targetId],
      )
      expect(await passwords.verifyPassword(target!.password_hash, PASSWORD)).toBe(true)
    } finally {
      await blocker.query('rollback')
      await blocker.end()
      if (settled) await settled
    }
  })

  it('refuses a transfer whose target actually leaves while the transfer waits', async () => {
    const f = await orderedFixture(true)
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    let operation: Promise<boolean> | undefined
    try {
      await blocker.query('begin')
      await blocker.query(
        `select id from app.memberships where department_id=$1 and user_id=$2 for update`,
        [f.department.id, f.headId],
      )
      const {
        rows: [backend],
      } = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
      operation = transferHeadship(f.department.id, f.headId, f.targetId, f.ctx)
      void operation.catch(() => undefined)
      await waitForMembershipWaiters(backend!.pid, 1)
      expect(
        await leaveDepartment(f.department.id, f.targetId, {
          ...f.ctx,
          userId: f.targetId,
          actorRole: 'member',
        }),
      ).toEqual({ ok: true })
      await blocker.query('commit')
      expect(await operation).toBe(false)
      const rows = await superuserQuery<{ user_id: string; role: string; status: string }>(
        db,
        `select user_id,role,status from app.memberships where department_id=$1 order by user_id`,
        [f.department.id],
      )
      expect(rows).toEqual([
        { user_id: f.headId, role: 'head', status: 'active' },
        { user_id: f.targetId, role: 'member', status: 'removed' },
      ])
      expect(
        await superuserQuery(
          db,
          `select id from app.outbox_events
        where type='departments.membership.changed' and payload->'userIds' is not null
          and department_id=$1`,
          [f.department.id],
        ),
      ).toEqual([])
    } finally {
      await blocker.query('rollback')
      await blocker.end()
      if (operation) await operation.catch(() => undefined)
    }
  })

  it('allows only one actual concurrent headship transfer from the same head', async () => {
    const f = await orderedFixture(true)
    const second = await seedMember(db, f.department.id, { role: 'member' })
    const blocker = new Client({ connectionString: db.superuserUrl })
    await blocker.connect()
    let settled: Promise<PromiseSettledResult<boolean>[]> | undefined
    try {
      await blocker.query('begin')
      await blocker.query(
        `select id from app.memberships where department_id=$1 and user_id=$2 for update`,
        [f.department.id, f.headId],
      )
      const {
        rows: [backend],
      } = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')
      settled = Promise.allSettled([
        transferHeadship(f.department.id, f.headId, f.targetId, f.ctx),
        transferHeadship(f.department.id, f.headId, second.id, f.ctx),
      ])
      await waitForMembershipWaiters(backend!.pid, 2)
      await blocker.query('commit')
      const outcomes = await settled
      expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(
        outcomes.map((result) => (result as PromiseFulfilledResult<boolean>).value).sort(),
      ).toEqual([false, true])
      const rows = await superuserQuery<{ user_id: string }>(
        db,
        `select user_id from app.memberships where department_id=$1 and role='head' and status='active'`,
        [f.department.id],
      )
      expect(rows).toHaveLength(1)
      expect([f.targetId, second.id]).toContain(rows[0]!.user_id)
    } finally {
      await blocker.query('rollback')
      await blocker.end()
      if (settled) await settled
    }
  })

  for (const scenario of [
    'member removal',
    'target lock',
    'target deletion',
    'head lock',
    'head demotion',
    'target promotion',
  ] as const) {
    it(`refuses a reset superseded by ${scenario} without credential or audit side effects`, async () => {
      const f = await fixture()
      const before = await securitySnapshot(f.target.id)
      const actualHash = passwords.hashPassword
      let release!: () => void
      let entered!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const hashing = new Promise<void>((resolve) => {
        entered = resolve
      })
      const spy = vi.spyOn(passwords, 'hashPassword').mockImplementationOnce(async (plain) => {
        entered()
        await gate
        return actualHash(plain)
      })
      const operation = resetMemberPassword(f.department.id, f.target.id, f.head.id, f.ctx)
      try {
        await hashing
        if (scenario === 'member removal')
          expect(await removeMember(f.department.id, f.target.id, f.ctx)).toBe(true)
        else if (scenario === 'target deletion')
          await superuserQuery(
            db,
            `update app.users set status='deleted', deleted_at=now() where id=$1`,
            [f.target.id],
          )
        else if (scenario === 'target lock' || scenario === 'head lock')
          await superuserQuery(db, `update app.users set status='locked' where id=$1`, [
            scenario === 'target lock' ? f.target.id : f.head.id,
          ])
        else
          await superuserQuery(
            db,
            `update app.memberships set role=$1, version=version+1
            where department_id=$2 and user_id=$3`,
            [
              scenario === 'head demotion' ? 'member' : 'head',
              f.department.id,
              scenario === 'head demotion' ? f.head.id : f.target.id,
            ],
          )
        release()
        expect((await operation).ok).toBe(false)
        expect(await securitySnapshot(f.target.id)).toEqual(before)
      } finally {
        release()
        await operation
        spy.mockRestore()
      }
    })
  }

  it('keeps a valid reset atomic and revokes the old session before accepting its temporary password', async () => {
    const f = await fixture()
    const result = await resetMemberPassword(f.department.id, f.target.id, f.head.id, f.ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected eligible local reset')
    expect(await securitySnapshot(f.target.id)).toEqual({
      oldPasswordWorks: false,
      mustChange: true,
      activeSessions: 0,
      resetAudits: 1,
      resetEvents: 1,
    })
    expect(
      (await fetch(`${server.baseUrl}/api/v1/me`, { headers: f.session.headers })).status,
    ).toBe(401)
    const current = await loginAs(server.baseUrl, f.target.login, result.temporaryPassword)
    expect((await fetch(`${server.baseUrl}/api/v1/me`, { headers: current.headers })).status).toBe(
      200,
    )
  })

  it('rolls credentials, session revocation and audit back when the real outbox insertion fails', async () => {
    const f = await fixture()
    const before = await securitySnapshot(f.target.id)
    const trigger = `qa_reset_${randomUUID().replaceAll('-', '')}`
    await superuserQuery(
      db,
      `create function app.${trigger}() returns trigger language plpgsql as $$
      begin if new.type='accounts.password.reset_by_head' and new.payload->>'userId'='${f.target.id}'
        then raise exception 'Synthetic head reset outbox failure'; end if; return new; end $$;
      create trigger ${trigger} before insert on app.outbox_events for each row execute function app.${trigger}();`,
    )
    try {
      await expect(
        resetMemberPassword(f.department.id, f.target.id, f.head.id, f.ctx),
      ).rejects.toThrow('Synthetic head reset outbox failure')
      expect(await securitySnapshot(f.target.id)).toEqual(before)
    } finally {
      await superuserQuery(
        db,
        `drop trigger ${trigger} on app.outbox_events; drop function app.${trigger}();`,
      )
    }
    expect((await resetMemberPassword(f.department.id, f.target.id, f.head.id, f.ctx)).ok).toBe(
      true,
    )
    expect(await securitySnapshot(f.target.id)).toEqual({
      oldPasswordWorks: false,
      mustChange: true,
      activeSessions: 0,
      resetAudits: 1,
      resetEvents: 1,
    })
  })
})

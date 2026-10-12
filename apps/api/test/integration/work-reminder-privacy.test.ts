import { randomUUID } from 'node:crypto'
import { configurePool, closePool, type RequestContext } from '@devon/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import { startProveDatabase, type ProveDatabase } from '../checks/pg-fixture.js'
import { seedDepartment, seedMember, superuserQuery } from './harness.js'
import { claimDueReminders, listReminderOwners } from '../../src/modules/work/plus-repo.js'
import { runReminderScan } from '../../src/modules/work/jobs.js'

// Only the excluded external fan-out is replaced. Owner RLS, claims and inbox insertion use the
// actual application-role connection against this file's disposable, migrated Postgres container.
vi.mock('../../src/modules/notifications/delivery.js', () => ({ deliverNotification: vi.fn() }))

let db: ProveDatabase
beforeAll(async () => {
  db = await startProveDatabase()
  configurePool(db.appUrl)
})
afterAll(async () => {
  await closePool()
  if (db) await db.stop()
})
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
function context(departmentId: string | null, userId: string | null, head = false): RequestContext {
  return {
    requestId: randomUUID(),
    departmentId,
    userId,
    actorRole: userId ? 'member' : 'super_admin',
    departmentRole: head ? 'head' : 'member',
    viewAs: false,
    actingForUserId: null,
    ip: '127.0.0.1',
    userAgent: 'local-work-reminder-regression',
  }
}
async function owner() {
  const department = await seedDepartment(db, {
    name: 'Reminder privacy',
    slug: `reminder-${randomUUID()}`,
  })
  const user = await seedMember(db, department.id, { role: 'member' })
  const cardId = randomUUID()
  await superuserQuery(
    db,
    'insert into app.cards (id,department_id,title,created_by_user_id,assignee_user_id) values ($1,$2,$3,$4,$4)',
    [cardId, department.id, 'Private reminder target', user.id],
  )
  return { departmentId: department.id, userId: user.id, cardId }
}
async function reminders(f: Awaited<ReturnType<typeof owner>>, count: number) {
  await superuserQuery(
    db,
    `insert into app.card_reminders (department_id,user_id,card_id,remind_at,note)
     select $1,$2,$3,now()-interval '1 minute','Private follow-up' from generate_series(1,$4::int)`,
    [f.departmentId, f.userId, f.cardId, count],
  )
}

describe('private reminder workers with actual FORCE RLS', () => {
  it('the global admin and another department head cannot claim private reminders; the owner can', async () => {
    const f = await owner()
    const other = await seedMember(db, f.departmentId, { role: 'head' })
    const foreign = await owner()
    await reminders(f, 2)
    expect(await claimDueReminders(context(null, null), 100)).toEqual([])
    expect(await claimDueReminders(context(f.departmentId, other.id, true), 100)).toEqual([])
    expect(await claimDueReminders(context(foreign.departmentId, f.userId), 100)).toEqual([])
    const claims = await claimDueReminders(context(f.departmentId, f.userId), 100)
    expect(claims).toHaveLength(2)
    expect(
      claims.every((row) => row.userId === f.userId && row.departmentId === f.departmentId),
    ).toBe(true)
    expect(await claimDueReminders(context(f.departmentId, f.userId), 100)).toEqual([])
  })

  it('enumerates eligible owners with bounded stable keyset pages without removed, locked or paused recipients', async () => {
    const eligible = await owner()
    const removed = await owner()
    const locked = await owner()
    const paused = await owner()
    await superuserQuery(db, "update app.memberships set status='removed' where user_id=$1", [
      removed.userId,
    ])
    await superuserQuery(db, "update app.users set status='locked' where id=$1", [locked.userId])
    await superuserQuery(db, "update app.departments set status='paused_by_admin' where id=$1", [
      paused.departmentId,
    ])
    const all = await listReminderOwners(context(null, null), null, 100)
    expect(all).toContainEqual({
      departmentId: eligible.departmentId,
      userId: eligible.userId,
      role: 'member',
    })
    expect(
      all.some((row) => [removed.userId, locked.userId, paused.userId].includes(row.userId)),
    ).toBe(false)
    const first = await listReminderOwners(context(null, null), null, 1)
    expect(first).toHaveLength(1)
    const rest = await listReminderOwners(context(null, null), first[0]!, 100)
    expect([...first, ...rest]).toEqual(all)
  })

  it('concurrent actual claims are disjoint and each remains bounded, including the 101st reminder', async () => {
    const f = await owner()
    await reminders(f, 101)
    const batches = await Promise.all([
      claimDueReminders(context(f.departmentId, f.userId), 100),
      claimDueReminders(context(f.departmentId, f.userId), 100),
    ])
    expect(batches.every((batch) => batch.length <= 100)).toBe(true)
    const ids = batches.flat().map((row) => row.id)
    expect(ids).toHaveLength(101)
    expect(new Set(ids).size).toBe(101)
    expect(await claimDueReminders(context(f.departmentId, f.userId), 100)).toEqual([])
    const persisted = await superuserQuery<{ count: number }>(
      db,
      'select count(*)::int as count from app.card_reminders where card_id=$1 and sent_at is not null',
      [f.cardId],
    )
    expect(persisted[0]!.count).toBe(101)
  })

  it('the real scan persists one inbox row per owner in different departments and does not repeat on redelivery', async () => {
    const first = await owner()
    const second = await owner()
    await reminders(first, 1)
    await reminders(second, 1)
    expect(await runReminderScan(log)).toBe(2)
    const receipts = await superuserQuery<{
      user_id: string
      subject_id: string
      deep_link: string
    }>(
      db,
      "select user_id,subject_id,deep_link from app.notifications where type='work.card.reminder' order by subject_id",
    )
    expect(receipts).toHaveLength(2)
    for (const f of [first, second]) {
      expect(receipts).toContainEqual({
        user_id: f.userId,
        subject_id: f.cardId,
        deep_link: `/work/card?id=${f.cardId}`,
      })
    }
    expect(await runReminderScan(log)).toBe(0)
    expect(
      (await superuserQuery(db, "select id from app.notifications where type='work.card.reminder'"))
        .length,
    ).toBe(2)
  })
})

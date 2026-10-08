import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { closePool, configurePool, withContext, type RequestContext } from '../../src/context.js'
import { seedDepartments } from '../checks/rls.js'
import { createCheckPool } from '../checks/pool.js'
import { startMigratedDatabase, type DatabaseFixture } from '../harness.js'

let db: DatabaseFixture
let admin: Client
let ctx: RequestContext

beforeAll(async () => {
  db = await startMigratedDatabase()
  admin = new Client({ connectionString: db.superuserUrl })
  await admin.connect()
  const [department] = await seedDepartments(db.superuserUrl, 1)
  ctx = {
    requestId: 'pool-recovery',
    userId: department!.userId,
    departmentId: department!.departmentId,
    actorRole: 'member',
    actingForUserId: null,
    viewAs: false,
    ip: '',
    userAgent: 'pool-recovery-test',
  }
  configurePool(db.appUrl)
})

afterAll(async () => {
  await closePool()
  await admin?.end()
  await db?.stop()
})

describe('database pool background errors', () => {
  it('closes migration check sockets before the database can be stopped', async () => {
    const applicationName = 'migration-check-close-regression'
    const checked = createCheckPool({
      connectionString: db.appUrl,
      application_name: applicationName,
      max: 20,
    })
    try {
      await Promise.all(Array.from({ length: 20 }, () => checked.pool.query('select 1')))
    } finally {
      await checked.close()
    }
    const remaining = await admin.query<{ count: number }>(
      'select count(*)::int as count from pg_stat_activity where application_name = $1',
      [applicationName],
    )
    expect(remaining.rows[0]!.count).toBe(0)
  })

  it('fails a migration check cleanly if its idle backend is terminated', async () => {
    const checked = createCheckPool({ connectionString: db.appUrl })
    const { rows } = await checked.pool.query<{ pid: number }>('select pg_backend_pid() as pid')
    const backgroundError = once(checked.pool, 'error')
    await admin.query('select pg_terminate_backend($1)', [rows[0]!.pid])
    const [error] = await backgroundError
    expect(error.code).toBe('57P01')
    await expect(checked.close()).rejects.toThrow('check pool background error (57P01)')
  })

  it('removes an idle terminated backend without crashing, then reconnects with tenant context', async () => {
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [before] = await withContext(ctx, (tx) =>
        tx.raw<{ pid: number }>(sql`select pg_backend_pid() as pid`),
      )
      await admin.query('select pg_terminate_backend($1)', [before!.pid])
      // Observe the actual asynchronous socket error, not a timing guess/sleep.
      await vi.waitFor(() => expect(diagnostic).toHaveBeenCalled(), { timeout: 5_000 })
      expect(diagnostic.mock.calls[0]).toEqual([
        '@devon/db: idle connection removed',
        { name: 'error', code: '57P01' },
      ])
      const [after] = await withContext(ctx, (tx) =>
        tx.raw<{ pid: number; department_id: string }>(sql`
          select pg_backend_pid() as pid, app.current_department_id() as department_id`),
      )
      expect(after!.pid).not.toBe(before!.pid)
      expect(after!.department_id).toBe(ctx.departmentId)
    } finally {
      diagnostic.mockRestore()
    }
  })

  it('still propagates active query errors and rolls back writes without retrying the transaction', async () => {
    const operation = vi.fn(async () => {
      await withContext(ctx, async (tx) => {
        await tx.raw(sql`update app.cards set title = 'must roll back'`)
        await tx.raw(sql`select 1 / 0`)
      })
    })
    await expect(operation()).rejects.toThrow()
    expect(operation).toHaveBeenCalledTimes(1)
    const rows = await withContext(ctx, (tx) =>
      tx.raw<{ title: string }>(sql`select title from app.cards`),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).not.toBe('must roll back')
  })
})

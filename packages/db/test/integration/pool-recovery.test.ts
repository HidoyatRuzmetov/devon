import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { sql } from 'drizzle-orm'
import { closePool, configurePool, withContext, type RequestContext } from '../../src/context.js'
import { seedDepartments } from '../checks/rls.js'
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

import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, configurePool } from '../../src/context.js'
import { DEMO_DEPARTMENT, DEMO_USERS, runResetDemo, runSeedDemo } from '../../src/seed/index.js'
import { startMigratedDatabase, type DatabaseFixture } from '../harness.js'

describe('used demo reset with persisted group delivery receipts', () => {
  let db: DatabaseFixture
  let client: Client
  beforeAll(async () => {
    db = await startMigratedDatabase()
    configurePool(db.appUrl)
    client = new Client({ connectionString: db.superuserUrl })
    await client.connect()
  }, 180_000)
  afterAll(async () => {
    await client?.end()
    await closePool()
    await db?.stop()
  })

  it('removes actual receipts before poll/event/group parents through the production reset path', async () => {
    const before = await client.query<{ count: string }>(
      'select count(*)::text as count from app.event_telegram_deliveries',
    )
    const seed = await runSeedDemo({ NODE_ENV: 'test', DATABASE_URL: db.appUrl })
    expect(seed.applied).toBe(true)
    const poll = await client.query<{ id: string; event_id: string }>(
      'select id, event_id from app.polls where department_id=$1 and event_id is not null order by id limit 1',
      [DEMO_DEPARTMENT.id],
    )
    expect(poll.rows).toHaveLength(1)
    const group = await client.query<{ id: string }>(
      'insert into app.telegram_groups (department_id, chat_id, connected_by) values ($1,-1004242427,$2) returning id',
      [DEMO_DEPARTMENT.id, DEMO_USERS[0]!.id],
    )
    const receipt = await client.query<{ id: string }>(
      `insert into app.event_telegram_deliveries (department_id,source_event_id,event_id,poll_id,group_id,event_type,group_kind)
       values ($1,gen_random_uuid(),$2,$3,$4,'events.poll_created','polls') returning id`,
      [DEMO_DEPARTMENT.id, poll.rows[0]!.event_id, poll.rows[0]!.id, group.rows[0]!.id],
    )
    expect(receipt.rows).toHaveLength(1)
    const stored = await client.query<{ count: string }>(
      'select count(*)::text as count from app.event_telegram_deliveries',
    )
    expect(Number(stored.rows[0]!.count)).toBe(Number(before.rows[0]!.count) + 1)
    const reset = await runResetDemo({ NODE_ENV: 'test', DATABASE_URL: db.appUrl })
    expect(reset.deleted).toBe(true)
    expect(
      (
        await client.query('select id from app.event_telegram_deliveries where id=$1', [
          receipt.rows[0]!.id,
        ])
      ).rows,
    ).toHaveLength(0)
    expect(
      (await client.query('select id from app.telegram_groups where id=$1', [group.rows[0]!.id]))
        .rows,
    ).toHaveLength(0)
    expect(
      (await client.query('select id from app.events where id=$1', [poll.rows[0]!.event_id])).rows,
    ).toHaveLength(0)
    expect(
      (await client.query('select id from app.polls where id=$1', [poll.rows[0]!.id])).rows,
    ).toHaveLength(0)
    expect(
      (await client.query('select id from app.departments where id=$1', [DEMO_DEPARTMENT.id])).rows,
    ).toHaveLength(0)
  }, 180_000)
})

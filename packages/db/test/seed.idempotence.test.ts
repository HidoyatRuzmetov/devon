// migrate-gate suite (design §2.7 step 6, item handoff): "seed twice, compare per-table counts."
// Exercises the *production* code path -- `runSeedDemo`/`runResetDemo` from `../src/seed/index.js`,
// which itself goes through `withContext()` -- against a throwaway Testcontainers Postgres, exactly
// like the other `test/integration/*.test.ts` suites. Requires Docker; not part of `test:unit`.
//
// The pure-function tests below (guard, ids, fixtures) need no database at all and are grouped first
// so a reader can see the whole contract before the slower Testcontainers section.
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, configurePool } from '../src/context.js'
import {
  DEMO_DELETE_ORDER,
  DEMO_DEPARTMENT,
  DEMO_MEMBERSHIPS,
  DEMO_USERS,
  SeedNotAllowedError,
  assertSeedAllowed,
  computeDemoChecksum,
  demoId,
  runResetDemo,
  runSeedDemo,
  uuidv5,
} from '../src/seed/index.js'
import { startMigratedDatabase, type DatabaseFixture } from './harness.js'

describe('assertSeedAllowed (AC-2 guard)', () => {
  it('allows a normal development boot', () => {
    expect(() =>
      assertSeedAllowed({ NODE_ENV: 'development', DEVON_DEMO: undefined }),
    ).not.toThrow()
  })

  it('allows an unset NODE_ENV', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: undefined, DEVON_DEMO: undefined })).not.toThrow()
  })

  it('allows test', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'test', DEVON_DEMO: undefined })).not.toThrow()
  })

  it('refuses production without the flag -- the AC-2 disproof', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', DEVON_DEMO: undefined })).toThrow(
      SeedNotAllowedError,
    )
  })

  it('refuses production with the flag set to anything other than the literal "1"', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', DEVON_DEMO: 'true' })).toThrow(
      SeedNotAllowedError,
    )
  })

  it('allows production when DEVON_DEMO=1 is explicit', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', DEVON_DEMO: '1' })).not.toThrow()
  })
})

describe('uuidv5 / demoId', () => {
  it('is deterministic: the same name always yields the same id', () => {
    expect(demoId('user.head')).toBe(demoId('user.head'))
  })

  it('gives different names different ids', () => {
    expect(demoId('user.head')).not.toBe(demoId('user.member'))
  })

  it('produces a version-5, variant-RFC4122 UUID', () => {
    const id = uuidv5('probe')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})

describe('demo fixtures', () => {
  it('gives every user a matching membership in the one demo department', () => {
    expect(DEMO_MEMBERSHIPS).toHaveLength(DEMO_USERS.length)
    for (const membership of DEMO_MEMBERSHIPS) {
      expect(membership.departmentId).toBe(DEMO_DEPARTMENT.id)
    }
  })

  it('computeDemoChecksum is stable across calls', () => {
    expect(computeDemoChecksum()).toBe(computeDemoChecksum())
  })

  it('DEMO_DELETE_ORDER lists children before parents (memberships, departments, users)', () => {
    expect(DEMO_DELETE_ORDER.map((t) => t.table)).toEqual([
      'app.memberships',
      'app.departments',
      'app.users',
    ])
  })
})

describe('seed:demo / seed:reset idempotence (design §2.7 step 6, Testcontainers)', () => {
  let db: DatabaseFixture
  let client: Client
  // `app.departments`/`app.memberships` are RLS-forced (design §2.4): a plain devon_app connection
  // with no department/actor GUCs set sees zero rows of them regardless of what exists, by design
  // (default-deny). Counting "the real number of rows" therefore has to bypass RLS the same way the
  // migrate-gate's own tenancy/rls checks do -- as the superuser -- while everything actually exercised
  // through `runSeedDemo`/`runResetDemo` still goes through the application role via `withContext`.
  let superuserClient: Client
  const previousEnv = { NODE_ENV: process.env['NODE_ENV'], DEVON_DEMO: process.env['DEVON_DEMO'] }

  async function tableCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const table of ['app.users', 'app.departments', 'app.memberships', 'app.seed_runs']) {
      const { rows } = await superuserClient.query<{ n: string }>(
        `select count(*)::bigint as n from ${table}`,
      )
      out[table] = Number(rows[0]!.n)
    }
    return out
  }

  async function isDemoFlag(): Promise<boolean> {
    const { rows } = await client.query<{ is_demo: boolean }>(
      'select is_demo from app.instance_settings where id = 1',
    )
    return rows[0]!.is_demo
  }

  beforeAll(async () => {
    db = await startMigratedDatabase()
    configurePool(db.appUrl)
    client = new Client({ connectionString: db.appUrl })
    await client.connect()
    superuserClient = new Client({ connectionString: db.superuserUrl })
    await superuserClient.connect()
    process.env['NODE_ENV'] = 'test'
    delete process.env['DEVON_DEMO']
    process.env['DATABASE_URL'] = db.appUrl
  }, 180_000)

  afterAll(async () => {
    await client?.end()
    await superuserClient?.end()
    await closePool()
    await db?.stop()
    process.env['NODE_ENV'] = previousEnv.NODE_ENV
    process.env['DEVON_DEMO'] = previousEnv.DEVON_DEMO
  })

  it('refuses under NODE_ENV=production without the flag before touching the database', async () => {
    const before = await tableCounts()
    process.env['NODE_ENV'] = 'production'
    try {
      await expect(runSeedDemo(process.env)).rejects.toBeInstanceOf(SeedNotAllowedError)
    } finally {
      process.env['NODE_ENV'] = 'test'
    }
    expect(await tableCounts()).toEqual(before)
  })

  it('applies the demo seed once, sets the demo chip flag, and writes an audit row', async () => {
    expect(await isDemoFlag()).toBe(false)

    const first = await runSeedDemo(process.env)
    expect(first.applied).toBe(true)
    expect(first.rowsWritten).toBeGreaterThan(0)

    const counts = await tableCounts()
    expect(counts['app.departments']).toBe(1)
    expect(counts['app.users']).toBe(DEMO_USERS.length)
    expect(counts['app.memberships']).toBe(DEMO_MEMBERSHIPS.length)
    expect(counts['app.seed_runs']).toBe(1)
    expect(await isDemoFlag()).toBe(true)

    const audited = await client.query<{ n: string }>(
      `select count(*)::bigint as n from audit.events where action = 'seed.demo_applied'`,
    )
    expect(Number(audited.rows[0]!.n)).toBe(1)
  })

  it('a second run changes no row counts and reports 0 rows written -- the AC-1 disproof', async () => {
    const before = await tableCounts()

    const second = await runSeedDemo(process.env)
    expect(second.applied).toBe(false)
    expect(second.rowsWritten).toBe(0)
    expect(second.message).toMatch(/already applied/)
    expect(second.message).toContain(second.checksum)

    expect(await tableCounts()).toEqual(before)
  })

  it('seed:reset --demo deletes exactly the demo rows and turns the chip back off', async () => {
    const reset = await runResetDemo(process.env)
    expect(reset.deleted).toBe(true)
    expect(reset.rowsDeleted).toBeGreaterThan(0)

    const counts = await tableCounts()
    expect(counts['app.departments']).toBe(0)
    expect(counts['app.users']).toBe(0)
    expect(counts['app.memberships']).toBe(0)
    expect(counts['app.seed_runs']).toBe(0)
    expect(await isDemoFlag()).toBe(false)

    // audit.events is never deleted by a reset (I-3, I-5a) -- the applied-seed row from the first test
    // must still be there even though every app.* row it described is gone.
    const audited = await client.query<{ n: string }>(
      `select count(*)::bigint as n from audit.events where action in ('seed.demo_applied','seed.demo_reset')`,
    )
    expect(Number(audited.rows[0]!.n)).toBe(2)
  })

  it('resetting again is a no-op', async () => {
    const before = await tableCounts()
    const second = await runResetDemo(process.env)
    expect(second.deleted).toBe(false)
    expect(second.rowsDeleted).toBe(0)
    expect(await tableCounts()).toEqual(before)
  })

  it('re-seeding after a reset writes the same ids again (deterministic, ON CONFLICT DO NOTHING-safe)', async () => {
    const reseeded = await runSeedDemo(process.env)
    expect(reseeded.applied).toBe(true)
    const { rows } = await superuserClient.query<{ id: string }>('select id from app.departments')
    expect(rows.map((r) => r.id)).toEqual([DEMO_DEPARTMENT.id])
  })
})

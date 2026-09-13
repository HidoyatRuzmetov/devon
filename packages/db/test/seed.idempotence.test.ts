// migrate-gate suite (design §2.7 step 6, item handoff): "seed twice, compare per-table counts."
// Exercises the *production* code path -- `runSeedDemo`/`runResetDemo` from `../src/seed/index.js`,
// which itself goes through `withContext()` -- against a throwaway Testcontainers Postgres, exactly
// like the other `test/integration/*.test.ts` suites. Requires Docker; not part of `test:unit`.
//
// The seed is every module under `src/seed/modules/` (core + accounts + departments + structure + work
// + projects + events + notifications + personal), so the counts below are for the whole dataset, and
// the reset assertion is the strongest one there is: after `seed:reset --demo`, *every* `app.*` table
// is back to exactly its pre-seed row count -- zero leftover rows, in any table, including the ones
// a module writes under a re-pointed department/user GUC.
//
// The pure-function tests below (guard, ids, fixtures, loader) need no database at all and are
// grouped first so a reader can see the whole contract before the slower Testcontainers section.
import { randomBytes } from 'node:crypto'
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
  loadSeedModules,
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

describe('seed module loader', () => {
  it('every module that writes rows of its own also knows how to reset them', async () => {
    const modules = await loadSeedModules()
    expect(modules.length).toBeGreaterThan(1)
    // `core.ts` (order 0) is the one module without `reset()`: its rows are `DEMO_DELETE_ORDER`,
    // deleted by `runResetDemo` itself. Every other module must carry its own.
    const withoutReset = modules.filter((m) => typeof m.reset !== 'function')
    expect(withoutReset.map((m) => m.order)).toEqual([0])
  })
})

describe('seed:demo / seed:reset idempotence (design §2.7 step 6, Testcontainers)', () => {
  let db: DatabaseFixture
  let client: Client
  // Most `app.*` tables are RLS-forced (design §2.4): a plain devon_app connection with no
  // department/actor/user GUCs set sees zero rows of them regardless of what exists, by design
  // (default-deny). Counting "the real number of rows" therefore has to bypass RLS the same way the
  // migrate-gate's own tenancy/rls checks do -- as the superuser -- while everything actually exercised
  // through `runSeedDemo`/`runResetDemo` still goes through the application role via `withContext`.
  let superuserClient: Client
  const previousEnv = { NODE_ENV: process.env['NODE_ENV'], DEVON_DEMO: process.env['DEVON_DEMO'] }

  // The whole dataset, every module included (`src/seed/modules/*.ts`):
  //   users        core 2 + DEMO_SUPER_ADMIN 1 (package demo-super-admin, core.ts) + accounts 38 +
  //     work 14 + structure 6
  //   departments  core 1 + departments 2 + structure 1 + admin 2 (showcase: one paused, one
  //     archived, both member-less -- EPIC-013's admin.ts, added after this constant was first
  //     written; blitz integration fix bumped it from 4 to 6 to match)
  const EXPECTED_USERS = 61
  const EXPECTED_DEPARTMENTS = 6

  // One table per module that only that module writes -- proof each module's `seed()` ran, so a
  // later "back to baseline" cannot pass merely because a module silently seeded nothing.
  const ONE_TABLE_PER_MODULE = [
    'app.department_requests', // departments
    'app.units', // structure
    'app.labels', // work
    'app.projects', // projects
    'app.events', // events
    'app.notifications', // notifications
    'app.personal_sprints', // personal
  ]

  /** Every base table in the `app` schema, from `information_schema` (like `cli-counts.ts`), so this
   * list never drifts from the schema by hand. `app._migrations` is bookkeeping the seed never
   * touches; leaving it out keeps the snapshot about data. */
  async function appTables(): Promise<string[]> {
    const { rows } = await superuserClient.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'app' and table_type = 'BASE TABLE' and table_name <> '_migrations'
       order by table_name`,
    )
    return rows.map((r) => `app.${r.table_name}`)
  }

  async function tableCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const table of await appTables()) {
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

  /** What a real login leaves behind: a session row pointing at a demo account. Not a seed row --
   * exactly the FK `seed:reset --demo` has to survive (`sessions_user_id_fkey`). */
  async function fakeLogin(userId: string): Promise<void> {
    await superuserClient.query(
      `insert into app.sessions (user_id, token_hash, csrf_hash, expires_at)
       values ($1, $2, $3, now() + interval '1 day')`,
      [userId, randomBytes(32), randomBytes(32)],
    )
  }

  let baseline: Record<string, number>
  let afterFirstSeed: Record<string, number>

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
    baseline = await tableCounts()
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
    process.env['NODE_ENV'] = 'production'
    try {
      await expect(runSeedDemo(process.env)).rejects.toBeInstanceOf(SeedNotAllowedError)
    } finally {
      process.env['NODE_ENV'] = 'test'
    }
    expect(await tableCounts()).toEqual(baseline)
  })

  it('applies the whole demo seed once, sets the demo chip flag, and writes an audit row', async () => {
    expect(await isDemoFlag()).toBe(false)

    const first = await runSeedDemo(process.env)
    expect(first.applied).toBe(true)
    expect(first.rowsWritten).toBeGreaterThan(0)

    afterFirstSeed = await tableCounts()
    expect(afterFirstSeed['app.departments']).toBe(EXPECTED_DEPARTMENTS)
    expect(afterFirstSeed['app.users']).toBe(EXPECTED_USERS)
    expect(afterFirstSeed['app.seed_runs']).toBe(1)
    for (const table of ONE_TABLE_PER_MODULE) {
      expect(afterFirstSeed[table], table).toBeGreaterThan(0)
    }
    expect(await isDemoFlag()).toBe(true)

    const audited = await client.query<{ n: string }>(
      `select count(*)::bigint as n from audit.events where action = 'seed.demo_applied'`,
    )
    expect(Number(audited.rows[0]!.n)).toBe(1)
  })

  it('a second run changes no row counts and reports 0 rows written -- the AC-1 disproof', async () => {
    const second = await runSeedDemo(process.env)
    expect(second.applied).toBe(false)
    expect(second.rowsWritten).toBe(0)
    expect(second.message).toMatch(/already applied/)
    expect(second.message).toContain(second.checksum)

    expect(await tableCounts()).toEqual(afterFirstSeed)
  })

  it('seed:reset --demo survives demo logins, deletes every demo row in every table, and turns the chip back off', async () => {
    // A presenter logged in as the core head *and* as an account a later module seeded (every demo
    // account shares DEMO_PASSWORD): both sessions must be swept, or the users delete fails.
    await fakeLogin(DEMO_USERS[0]!.id)
    const { rows: others } = await superuserClient.query<{ id: string }>(
      'select id from app.users where id <> all($1::uuid[]) order by login limit 1',
      [DEMO_USERS.map((u) => u.id)],
    )
    expect(others).toHaveLength(1)
    await fakeLogin(others[0]!.id)

    const reset = await runResetDemo(process.env)
    expect(reset.deleted).toBe(true)
    expect(reset.rowsDeleted).toBeGreaterThan(0)

    // The strongest form of "exactly the demo rows and nothing else": every app.* table is back to
    // its pre-seed count -- so no module left a row behind (including rows written under a
    // re-pointed department/user GUC), and nothing that was there before the seed was touched.
    expect(await tableCounts()).toEqual(baseline)
    expect(await isDemoFlag()).toBe(false)

    // audit.events is never deleted by a reset (I-3, I-5a) -- the applied-seed row from the first test
    // must still be there even though every app.* row it described is gone.
    const audited = await client.query<{ n: string }>(
      `select count(*)::bigint as n from audit.events where action in ('seed.demo_applied','seed.demo_reset')`,
    )
    expect(Number(audited.rows[0]!.n)).toBe(2)
  }, 60_000)

  it('resetting again is a no-op', async () => {
    const second = await runResetDemo(process.env)
    expect(second.deleted).toBe(false)
    expect(second.rowsDeleted).toBe(0)
    expect(await tableCounts()).toEqual(baseline)
  })

  /**
   * v1.1 critique SEV2 #24, and the reason it survived three fixes. Every row below is one the
   * *product* writes and no seed module could ever name: a fill request a head actually sent, the
   * day the analytics rollup wrote, a document the search indexer wrote, a run the automations
   * engine appended, a card a presenter created and the comment somebody left on it, a notification
   * and its delivery, a saved view, a calendar feed, a push subscription, a Telegram link, an
   * upload, a personal task and the Pomodoro run against it.
   *
   * Before `reset-sweep.ts` this test would have failed on the very first of them --
   * `field_requests_user_id_fkey`, then `analytics_daily_department_id_fkey`, then
   * `ai_search_documents_department_id_fkey`, which is exactly the sequence the v1.1 report
   * recorded against the real demo box. It exists so that "reset the demo before the presentation"
   * is a property of a *used* instance, which is the only kind that ever needs it.
   */
  async function writeRowsTheProductWrites(): Promise<void> {
    const one = async <T>(query: string, params: unknown[] = []): Promise<T | undefined> => {
      const { rows } = await superuserClient.query(query, params)
      return rows[0] as T | undefined
    }
    const dept = DEMO_DEPARTMENT.id
    const head = DEMO_USERS[0]!.id
    const member = DEMO_USERS[1]!.id
    const card = (await one<{ id: string }>(
      'select id from app.cards where department_id = $1 order by id limit 1',
      [dept],
    ))!
    const fieldDef = (await one<{ id: string }>(
      'select id from app.field_defs where department_id = $1 order by id limit 1',
      [dept],
    ))!
    const rule = (await one<{ id: string }>(
      'select id from app.automation_rules where department_id = $1 order by id limit 1',
      [dept],
    ))!
    const sprint = await one<{ id: string }>(
      'select id from app.personal_sprints where user_id = $1 order by id limit 1',
      [member],
    )

    // Every row below gets a database-generated id -- never one any `demoId(...)` could produce,
    // which is exactly what made them invisible to a reset that deleted by seeded id.
    await superuserClient.query(
      `insert into app.field_requests (department_id, def_id, user_id, requested_by_user_id)
       values ($1, $2, $3, $4)`,
      [dept, fieldDef.id, member, head],
    )
    await superuserClient.query(
      `insert into app.analytics_daily (department_id, day) values ($1, current_date + 1)`,
      [dept],
    )
    await superuserClient.query(
      `insert into app.ai_search_documents (department_id, subject_type, subject_id)
       values ($1, 'card', $2)`,
      [dept, card.id],
    )
    await superuserClient.query(
      `insert into app.automation_runs (department_id, rule_id, card_id, status)
       values ($1, $2, $3, 'applied')`,
      [dept, rule.id, card.id],
    )
    const appCard = (await one<{ id: string }>(
      `insert into app.cards (department_id, title, created_by_user_id, assignee_user_id)
       values ($1, 'Prezentatsiya paytida ochilgan karta', $2, $3) returning id`,
      [dept, head, member],
    ))!
    await superuserClient.query(
      `insert into app.card_comments (department_id, card_id, author_user_id, body)
       values ($1, $2, $3, '{"text":"izoh"}'::jsonb)`,
      [dept, appCard.id, head],
    )
    await superuserClient.query(
      `insert into app.card_activity (department_id, card_id, kind, actor_user_id)
       values ($1, $2, 'created', $3)`,
      [dept, appCard.id, head],
    )
    await superuserClient.query(
      `insert into app.card_time_logs (department_id, card_id, user_id, minutes)
       values ($1, $2, $3, 30)`,
      [dept, appCard.id, member],
    )
    await superuserClient.query(
      `insert into app.focus_pins (department_id, user_id, card_id) values ($1, $2, $3)`,
      [dept, member, appCard.id],
    )
    await superuserClient.query(
      `insert into app.goals (department_id, title, created_by_user_id)
       values ($1, 'Prezentatsiyada qoshilgan maqsad', $2)`,
      [dept, head],
    )
    await superuserClient.query(
      `insert into app.people_views (department_id, owner_user_id, name)
       values ($1, $2, 'Mening korinishim')`,
      [dept, head],
    )
    await superuserClient.query(
      `insert into app.saved_views (department_id, owner_user_id, name)
       values ($1, $2, 'Kechikkanlar')`,
      [dept, head],
    )
    const notification = (await one<{ id: string }>(
      `insert into app.notifications (user_id, department_id, type, reason, subject_type, title)
       values ($1, $2, 'card.assigned', 'assigned', 'card', '{"uz-Latn":"Yangi vazifa"}'::jsonb)
       returning id`,
      [member, dept],
    ))!
    await superuserClient.query(
      `insert into app.notification_deliveries (user_id, notification_id, channel)
       values ($1, $2, 'inapp')`,
      [member, notification.id],
    )
    await superuserClient.query(
      `insert into app.calendar_feeds (user_id, secret) values ($1, 'kalendar-siri')`,
      [member],
    )
    await superuserClient.query(
      `insert into app.push_subscriptions (user_id, endpoint, p256dh, auth_secret)
       values ($1, 'https://push.example/endpoint', 'p256dh', 'auth')`,
      [member],
    )
    // Whichever demo account has not linked Telegram yet -- `telegram_links` is keyed by user, and
    // the seed already links the two personas.
    await superuserClient.query(
      `insert into app.telegram_links (user_id, chat_id)
       select id, 424242 from app.users
       where id not in (select user_id from app.telegram_links) order by id limit 1`,
    )
    await superuserClient.query(
      `insert into app.telegram_groups (department_id, chat_id, connected_by)
       values ($1, -1001234567, $2)`,
      [dept, head],
    )
    await superuserClient.query(
      `insert into app.join_attempts (ok, department_id, user_id) values (true, $1, $2)`,
      [dept, member],
    )
    await superuserClient.query(
      `insert into app.outbox_events (type, payload, department_id)
       values ('card.created', '{}'::jsonb, $1)`,
      [dept],
    )
    await superuserClient.query(
      `insert into app.uploads (user_id, purpose, key, mime, size, expires_at)
       values ($1, 'avatar', 'k/1', 'image/png', 10, now() + interval '1 day')`,
      [member],
    )
    const task = (await one<{ id: string }>(
      `insert into app.personal_tasks (user_id, title, sprint_id)
       values ($1, 'Prezentatsiyadan keyin', $2) returning id`,
      [member, sprint?.id ?? null],
    ))!
    await superuserClient.query(
      `insert into app.pomodoro_sessions (user_id, kind, started_at, task_id)
       values ($1, 'focus', now(), $2)`,
      [member, task.id],
    )
  }

  it('re-seeding after a reset writes the same rows again (deterministic, ON CONFLICT DO NOTHING-safe)', async () => {
    const reseeded = await runSeedDemo(process.env)
    expect(reseeded.applied).toBe(true)
    expect(await tableCounts()).toEqual(afterFirstSeed)
    const { rows } = await superuserClient.query<{ id: string }>(
      'select id from app.departments order by id',
    )
    expect(rows.map((r) => r.id)).toContain(DEMO_DEPARTMENT.id)
    expect(rows).toHaveLength(EXPECTED_DEPARTMENTS)
  })
  it('seed:reset --demo survives a database people have actually used', async () => {
    // The database is seeded again at this point -- the test above re-seeded it.
    await writeRowsTheProductWrites()

    const used = await tableCounts()
    // Non-vacuous: the rows have to actually be there for the reset to have to survive them.
    for (const table of [
      'app.field_requests',
      'app.analytics_daily',
      'app.ai_search_documents',
      'app.automation_runs',
      'app.notifications',
      'app.calendar_feeds',
      'app.telegram_groups',
      'app.people_views',
      'app.outbox_events',
      'app.pomodoro_sessions',
    ]) {
      expect(used[table], table).toBeGreaterThan(afterFirstSeed[table] ?? 0)
    }

    const reset = await runResetDemo(process.env)
    expect(reset.deleted).toBe(true)

    // Back to the pre-seed baseline -- including every row above, none of which any seed module
    // could name. This is the assertion the three foreign-key crashes were hiding behind.
    expect(await tableCounts()).toEqual(baseline)
    expect(await isDemoFlag()).toBe(false)
  }, 60_000)
})

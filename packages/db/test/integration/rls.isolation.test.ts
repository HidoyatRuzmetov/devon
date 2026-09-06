// migrate-gate suite (design §2.7 step 4, item AC-10). Requires Docker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool } from '../../src/context.js'
import { printReport } from '../checks/assert.js'
import {
  runPgBouncerConcurrencyCheck,
  runRlsIsolationChecks,
  seedDepartments,
  type SeededDepartment,
} from '../checks/rls.js'
import type { CheckResult } from '../checks/types.js'
import {
  startMigratedDatabase,
  startPgBouncer,
  type DatabaseFixture,
  type PgBouncerFixture,
} from '../harness.js'

let db: DatabaseFixture
let pgbouncer: PgBouncerFixture
let seeded: SeededDepartment[]
let isolationResults: CheckResult[]
let concurrencyResults: CheckResult[]

beforeAll(async () => {
  db = await startMigratedDatabase()
  seeded = await seedDepartments(db.superuserUrl, 4)
  isolationResults = await runRlsIsolationChecks(db.appUrl, seeded)
  printReport('rls.isolation (Drizzle + raw)', isolationResults)

  pgbouncer = await startPgBouncer(db)
  concurrencyResults = await runPgBouncerConcurrencyCheck(pgbouncer.connectionString, seeded, 20)
  printReport('rls.isolation (PgBouncer concurrency)', concurrencyResults)
}, 180_000)

afterAll(async () => {
  await closePool()
  await pgbouncer?.stop()
  await db?.stop()
})

describe('RLS cross-department isolation (AC-10, item handoff)', () => {
  it('Drizzle path: department A never sees department B rows', () => {
    const r = isolationResults.find((x) => x.name.includes('Drizzle path: department A'))
    expect(r?.ok).toBe(true)
  })

  it('tx.raw() path: department A never sees department B rows', () => {
    const r = isolationResults.find((x) => x.name.includes('tx.raw() path: department A'))
    expect(r?.ok).toBe(true)
  })

  it('symmetric: department B never sees department A rows (Drizzle and raw)', () => {
    const failed = isolationResults.filter((x) => x.name.includes('department B') && !x.ok)
    expect(failed).toEqual([])
  })

  it('an unset department context on app.memberships never crosses users (self-read carve-out)', () => {
    const r = isolationResults.find((x) => x.name.includes('self-read carve-out'))
    expect(r?.ok).toBe(true)
  })

  it('an unset department context returns zero rows for a user with no memberships of their own', () => {
    const r = isolationResults.find((x) => x.name.includes('no memberships of their own'))
    expect(r?.ok).toBe(true)
  })

  it('every isolation check passes', () => {
    const failed = isolationResults.filter((r) => !r.ok)
    expect(failed).toEqual([])
  })

  it('20 concurrent transactions through PgBouncer show zero cross-department reads', () => {
    const failed = concurrencyResults.filter((r) => !r.ok)
    expect(failed).toEqual([])
  })
})

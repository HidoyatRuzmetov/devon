// migrate-gate suite (design §2.7 step 3). Requires Docker; run via `pnpm migrate:verify`, not
// `test:unit`. Every base table in `app`/`audit` must be classified in `TENANCY`, and the mechanism is
// proven generically against two throwaway tables, not just the two real tables that exist today.
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runTenancyRegistryChecks } from '../checks/tenancy.js'
import { expectAllOk, find, printReport } from '../checks/assert.js'
import type { CheckResult } from '../checks/types.js'
import { startMigratedDatabase, type DatabaseFixture } from '../harness.js'

let db: DatabaseFixture
let client: Client
let results: CheckResult[]

beforeAll(async () => {
  db = await startMigratedDatabase()
  client = new Client({ connectionString: db.superuserUrl })
  await client.connect()
  results = await runTenancyRegistryChecks(client)
  printReport('tenancy.registry', results)
}, 180_000)

afterAll(async () => {
  await client?.end()
  await db?.stop()
})

describe('tenancy registry (AC-10, item handoff)', () => {
  it('classifies every base table in app/audit', () => {
    expect(find(results, 'every base table in app/audit is classified').ok).toBe(true)
  })

  it('fails an unclassified table', () => {
    expect(find(results, 'an unclassified table fails checkTenancyCoverage').ok).toBe(true)
  })

  it('proves the department_owned mechanism on a throwaway table', () => {
    const relevant = results.filter((r) => r.name.startsWith('throwaway department_owned'))
    expect(relevant.length).toBeGreaterThan(0)
    expectAllOk(relevant)
  })

  it('proves the user_owned mechanism on a throwaway table gives no head/admin exception', () => {
    const relevant = results.filter((r) => r.name.startsWith('throwaway user_owned'))
    expect(relevant.length).toBeGreaterThan(0)
    expectAllOk(relevant)
  })

  it('every registry check passes', () => {
    expectAllOk(results)
  })
})

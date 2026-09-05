// migrate-gate suite (design §2.7 step 5, item AC-9). Requires Docker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runAuditImmutabilityChecks } from '../checks/audit.js'
import { printReport } from '../checks/assert.js'
import type { CheckResult } from '../checks/types.js'
import { startMigratedDatabase, type DatabaseFixture } from '../harness.js'

let db: DatabaseFixture
let results: CheckResult[]

beforeAll(async () => {
  db = await startMigratedDatabase()
  results = await runAuditImmutabilityChecks(db.superuserUrl, db.appUrl)
  printReport('audit.immutability', results)
}, 180_000)

afterAll(async () => {
  await db?.stop()
})

describe('audit immutability and hash chain (AC-9, item handoff)', () => {
  it('devon_app grants on audit.events are exactly INSERT, SELECT', () => {
    const r = results.find((x) => x.name.includes('grants on audit.events are exactly'))
    expect(r?.ok).toBe(true)
  })

  it('devon_app UPDATE, DELETE and TRUNCATE on audit.events are all denied', () => {
    const denials = results.filter((x) => x.name.includes('is denied'))
    expect(denials).toHaveLength(3)
    for (const d of denials) expect(d.ok).toBe(true)
  })

  it('500 concurrent inserts all succeed and the chain verifies ok', () => {
    const inserted = results.find((x) => x.name.includes('concurrent inserts all succeed'))
    const verified = results.find((x) => x.name.includes('reports ok after the concurrent build'))
    expect(inserted?.ok).toBe(true)
    expect(verified?.ok).toBe(true)
  })

  it('tampering with one row as a superuser makes verify_chain() report exactly that seq', () => {
    const r = results.find((x) => x.name.includes('reports exactly the tampered seq'))
    expect(r?.ok).toBe(true)
  })

  it('every immutability check passes', () => {
    const failed = results.filter((r) => !r.ok)
    expect(failed).toEqual([])
  })
})

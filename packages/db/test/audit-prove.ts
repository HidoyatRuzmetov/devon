#!/usr/bin/env tsx
// `pnpm --filter @devon/db audit:prove` -- the one-command evidence producer named in design §9 for
// AC-9: three denials as devon_app, the concurrent chain build, and tamper detection, on a throwaway
// Testcontainers database.
import { runAuditImmutabilityChecks } from './checks/audit.js'
import { printReport } from './checks/assert.js'
import { startMigratedDatabase } from './harness.js'

async function main(): Promise<boolean> {
  const db = await startMigratedDatabase()
  try {
    const results = await runAuditImmutabilityChecks(db.superuserUrl, db.appUrl)
    printReport('audit.immutability', results)
    return results.every((r) => r.ok)
  } finally {
    await db.stop()
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error('[audit:prove] crashed:', err)
    process.exit(1)
  })

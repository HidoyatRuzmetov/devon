#!/usr/bin/env tsx
// `pnpm --filter @devon/db tenancy:report` -- the one-command evidence producer named in design §9 for
// AC-10: table x class x policy x cross-read matrix, on a throwaway Testcontainers database.
import { Client } from 'pg'
import { printReport } from './checks/assert.js'
import { runTenancyRegistryChecks } from './checks/tenancy.js'
import { startMigratedDatabase } from './harness.js'

async function main(): Promise<boolean> {
  const db = await startMigratedDatabase()
  try {
    const client = new Client({ connectionString: db.superuserUrl })
    await client.connect()
    try {
      const results = await runTenancyRegistryChecks(client)
      printReport('tenancy.registry', results)
      return results.every((r) => r.ok)
    } finally {
      await client.end()
    }
  } finally {
    await db.stop()
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error('[tenancy:report] crashed:', err)
    process.exit(1)
  })

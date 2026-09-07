#!/usr/bin/env tsx
// `pnpm --filter @devon/db migrate:verify` -- the evidence producer for AC-9, AC-10 and the `migrate`
// gate (design §2.7, item "Done when"). Runs everything against fresh Testcontainers Postgres/PgBouncer
// instances: nobody has to invent a procedure to reproduce this by hand.
import { Client } from 'pg'
import { closePool } from '../src/context.js'
import { printReport } from './checks/assert.js'
import { runAuditImmutabilityChecks } from './checks/audit.js'
import { lintMigrations } from './checks/migration-lint.js'
import {
  runPgBouncerConcurrencyCheck,
  runRlsIsolationChecks,
  seedDepartments,
} from './checks/rls.js'
import { runTenancyRegistryChecks } from './checks/tenancy.js'
import type { CheckResult } from './checks/types.js'
import {
  applyMigrations,
  readMigrationFiles,
  startMigratedDatabase,
  startPgBouncer,
} from './harness.js'

async function main(): Promise<boolean> {
  const sections: Array<{ label: string; results: CheckResult[] }> = []

  console.log('[migrate:verify] 1/7 lint the migration files (no database needed)')
  const files = readMigrationFiles()
  sections.push({ label: 'migration-lint', results: lintMigrations(files) })

  console.log('[migrate:verify] 2/7 apply migrations to a fresh Postgres 17 (+pgvector) container')
  const db = await startMigratedDatabase()

  try {
    console.log('[migrate:verify] 3/7 apply the same migrations again (idempotence)')
    let idempotent = true
    let idempotentDetail: string | undefined
    try {
      await applyMigrations(db.superuserUrl, db.creds, files)
    } catch (err) {
      idempotent = false
      idempotentDetail = (err as Error).message
    }
    sections.push({
      label: 'idempotence',
      results: [
        {
          name: 'applying every migration a second time exits cleanly',
          ok: idempotent,
          detail: idempotentDetail,
        },
      ],
    })

    console.log('[migrate:verify] 4/7 tenancy registry (AC-10)')
    const superuserClient = new Client({ connectionString: db.superuserUrl })
    await superuserClient.connect()
    try {
      sections.push({
        label: 'tenancy.registry',
        results: await runTenancyRegistryChecks(superuserClient),
      })
    } finally {
      await superuserClient.end()
    }

    console.log(
      '[migrate:verify] 5/7 RLS cross-department isolation, Drizzle path + tx.raw() (AC-10)',
    )
    const seeded = await seedDepartments(db.superuserUrl, 4)
    const isolationResults = await runRlsIsolationChecks(db.appUrl, seeded, db.superuserUrl)
    sections.push({ label: 'rls.isolation', results: isolationResults })

    console.log(
      '[migrate:verify] 6/7 RLS isolation under 20 concurrent transactions through PgBouncer (AC-10)',
    )
    const pgbouncer = await startPgBouncer(db)
    try {
      sections.push({
        label: 'rls.isolation.pgbouncer',
        results: await runPgBouncerConcurrencyCheck(pgbouncer.connectionString, seeded, 20),
      })
    } finally {
      await pgbouncer.stop()
    }

    console.log('[migrate:verify] 7/7 audit immutability, hash chain and tamper detection (AC-9)')
    sections.push({
      label: 'audit.immutability',
      results: await runAuditImmutabilityChecks(db.superuserUrl, db.appUrl),
    })
  } finally {
    await closePool()
    await db.stop()
  }

  let allOk = true
  for (const section of sections) {
    printReport(section.label, section.results)
    if (section.results.some((r) => !r.ok)) allOk = false
  }

  const total = sections.reduce((n, s) => n + s.results.length, 0)
  const failed = sections.reduce((n, s) => n + s.results.filter((r) => !r.ok).length, 0)
  console.log(
    `\n[migrate:verify] ${total - failed}/${total} checks passed across ${sections.length} sections.`,
  )
  console.log(`[migrate:verify] ${allOk ? 'PASS' : 'FAIL'}`)
  return allOk
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error('[migrate:verify] crashed:', err)
    process.exit(1)
  })

#!/usr/bin/env tsx
// Read-only deployment guard. Unknown state fails closed; no schema is created here.
import { Client } from 'pg'
import { readMigrationFiles } from './migrate.js'

async function main() {
  const connectionString = process.env['MIGRATION_DATABASE_URL']
  if (!connectionString) throw new Error('missing migration connection')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows: tables } = await client.query<{ ledger: string | null }>(
      "select to_regclass('app._migrations')::text as ledger",
    )
    if (!tables[0]?.ledger) {
      const { rows } = await client.query<{ count: string }>(
        "select count(*) from information_schema.tables where table_schema='app'",
      )
      if (Number(rows[0]?.count) > 0) throw new Error('existing database has no migration ledger')
      console.log('none')
      return
    }
    const { rows } = await client.query<{ name: string }>('select name from app._migrations')
    const applied = new Set(rows.map((row) => row.name))
    const pending = readMigrationFiles().some(
      (file) => !applied.has(file.name) && /^-- (?:Contract migration:|CONTRACT:)/m.test(file.sql),
    )
    console.log(pending ? 'required' : 'none')
  } finally {
    await client.end()
  }
}
main().catch(() => {
  console.error('[deploy] could not determine pending contract migrations')
  process.exitCode = 1
})

#!/usr/bin/env tsx
// `pnpm --filter @devon/db counts` -- per-table row counts (item handoff), the other half of AC-1's
// evidence producer: run once, seed, run again, diff. Reads `information_schema` for the table list so
// it never drifts from the schema by hand-maintaining a name list.
//
// Connects as `DATABASE_URL` (the application role, `devon_app`), deliberately -- the same role every
// real request uses. That means `app.departments`/`app.memberships` (RLS-forced, design §2.4) show 0
// here regardless of what exists: this connection sets no `app.department_id`/`app.actor_role` GUC, so
// default-deny applies (I-1). That is correct, not a bug -- it is the tenancy model working as designed
// even from an ops shell -- but it means this command's before/after diff for those two tables is
// trivially "0 = 0" and does not by itself prove no-duplication for them; `test:seed-idempotence`
// (superuser-connected) is the check that actually counts those tables. `app.users`/`app.seed_runs`
// (global, unRLS'd) show real numbers here and do prove it for themselves.
import { Client } from 'pg'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('@devon/db counts: DATABASE_URL is not set')
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const { rows: tables } = await client.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name
       from information_schema.tables
       where table_schema in ('app', 'audit') and table_type = 'BASE TABLE'
       order by table_schema, table_name`,
    )
    console.log('schema.table                          rows')
    for (const t of tables) {
      const qualified = `"${t.table_schema}"."${t.table_name}"`
      const label = `${t.table_schema}.${t.table_name}`
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from ${qualified}`,
      )
      console.log(`${label.padEnd(38)} ${rows[0]!.count}`)
    }
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error('[counts] failed:', err)
  process.exit(1)
})

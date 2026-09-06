#!/usr/bin/env tsx
// `pnpm --filter @devon/db migrate:apply` -- the apply step `scripts/start.mjs` shells out to on
// every `pnpm start` (see MODULE-GUIDE.md "Migrations").
import { runMigrateApply } from './migrate.js'

async function main(): Promise<void> {
  const result = await runMigrateApply()
  if (result.applied.length === 0) {
    console.log(
      `[migrate:apply] up to date -- 0 migrations applied (${result.alreadyApplied.length} already applied)`,
    )
  } else {
    console.log(
      `[migrate:apply] applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[migrate:apply] failed:', err)
    process.exit(1)
  })

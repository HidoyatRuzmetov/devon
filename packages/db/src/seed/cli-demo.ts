#!/usr/bin/env tsx
// `pnpm --filter @devon/db seed:demo` -- one of the two entry points named in the item handoff.
// `scripts/start.mjs` (EPIC-000.1) shells out to exactly this script for `pnpm start --demo`.
import { closePool } from '../context.js'
import { SeedNotAllowedError } from './guard.js'
import { runSeedDemo } from './demo.js'

async function main(): Promise<void> {
  const outcome = await runSeedDemo(process.env)
  console.log(`[seed:demo] ${outcome.message}`)
}

main()
  .then(async () => {
    await closePool()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    await closePool().catch(() => {})
    if (err instanceof SeedNotAllowedError) {
      console.error(`[seed:demo] refused: ${err.message}`)
    } else {
      console.error('[seed:demo] failed:', err)
    }
    process.exit(1)
  })

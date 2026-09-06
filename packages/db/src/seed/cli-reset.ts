#!/usr/bin/env tsx
// `pnpm --filter @devon/db seed:reset --demo` -- the second entry point named in the item handoff. The
// `--demo` flag is required explicitly (not inferred) so that adding a future non-demo seed profile
// never makes this command ambiguous about what it is about to delete.
import { closePool } from '../context.js'
import { SeedNotAllowedError } from './guard.js'
import { runResetDemo } from './demo.js'

async function main(): Promise<void> {
  if (!process.argv.includes('--demo')) {
    throw new Error(
      'seed:reset requires an explicit --demo flag (only the demo profile exists today)',
    )
  }
  const outcome = await runResetDemo(process.env)
  console.log(`[seed:reset] ${outcome.message}`)
}

main()
  .then(async () => {
    await closePool()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    await closePool().catch(() => {})
    if (err instanceof SeedNotAllowedError) {
      console.error(`[seed:reset] refused: ${err.message}`)
    } else {
      console.error('[seed:reset] failed:', err)
    }
    process.exit(1)
  })

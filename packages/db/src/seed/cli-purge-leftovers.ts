// `pnpm --filter @devon/db seed:purge-leftovers [--dry-run]`
//
// Removes the automation debris a demo instance accumulates (see `purge-leftovers.ts` for what
// counts as debris and why this is not part of `seed:reset`). Prints exactly what it matched before
// saying it did anything, because a command that deletes by name pattern has to be auditable by the
// person running it, not just by the audit table.
import { runPurgeLeftovers } from './purge-leftovers.js'

const dryRun = process.argv.includes('--dry-run')

runPurgeLeftovers({ dryRun })
  .then((outcome) => {
    for (const d of outcome.departments) {
      // eslint-disable-next-line no-console -- a CLI's whole output is its console
      console.log(`department  ${d.name}`)
    }
    for (const u of outcome.users) {
      // eslint-disable-next-line no-console -- a CLI's whole output is its console
      console.log(`account     @${u.login}`)
    }
    const verb = outcome.previewOnly ? 'would remove' : 'removed'
    // eslint-disable-next-line no-console -- a CLI's whole output is its console
    console.log(
      `[seed:purge-leftovers] ${verb} ${outcome.departments.length} department(s) and ${outcome.users.length} account(s)`,
    )
    process.exit(0)
  })
  .catch((err: unknown) => {
    console.error('[seed:purge-leftovers] failed', err)
    process.exit(1)
  })

// On first boot with zero users, print exactly one single-use setup URL (AC-12). `ensureSetupToken`
// (src/db/repo.ts) only ever returns a token the very first time -- zero users AND zero
// `app.setup_tokens` rows -- so a restart before the link is used prints nothing further (design.md
// §5.4: recovery from a lost link is the separate, deliberate `setup:reissue` path, never a silent
// re-print of a token whose raw value the server can no longer produce).
import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.js'
import type { Deps } from '../deps.js'

export async function printSetupUrlIfNeeded(
  app: FastifyInstance,
  deps: Deps,
  config: Config,
): Promise<void> {
  const issued = await deps.ensureSetupToken()
  if (!issued) return
  const url = `${config.DEVON_PUBLIC_URL}/setup/${issued.token}`
  app.log.info({ setupUrl: url, expiresAt: issued.expiresAt.toISOString() }, 'first-boot setup URL')
  // Deliberately also a plain stdout line: this is the one message an operator with no log
  // aggregation must be able to see and copy on a bare `pnpm start`.
  // eslint-disable-next-line no-console -- the one intentional operator-facing line in this package
  console.log(`\nFirst-boot setup link (single use):\n  ${url}\n`)
}

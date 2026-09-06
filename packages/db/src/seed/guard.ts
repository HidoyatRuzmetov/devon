// The production/demo-flag guard (item handoff, AC-2, disproof-critical). Every seed entry point --
// `seed:demo`, `seed:reset --demo`, and the CLI matrix that proves this table -- calls this single
// testable function *before* opening a single database connection, so refusal in a production boot
// without the flag never depends on reaching Postgres at all.
// A plain (not `Pick<NodeJS.ProcessEnv, …>`) shape: `ProcessEnv` only has an index signature, so a
// `Pick` of it would require the two keys to be present rather than optional, and `process.env` itself
// would then fail to satisfy it. Declaring the two fields directly, as optional, is what makes
// `process.env` -- and any plain `{NODE_ENV, DEVON_DEMO}` test fixture -- assignable to this type.
export type SeedEnv = { NODE_ENV?: string | undefined; DEVON_DEMO?: string | undefined }

export class SeedNotAllowedError extends Error {
  constructor(
    message = 'demo seed refused: NODE_ENV=production requires DEVON_DEMO=1 to be set explicitly',
  ) {
    super(message)
    this.name = 'SeedNotAllowedError'
  }
}

/**
 * Refuses exactly one case: `NODE_ENV === 'production'` without the explicit opt-in `DEVON_DEMO=1`.
 * Every other combination -- development, test, an unset `NODE_ENV`, or production *with* the flag
 * (a demo/staging deploy) -- is allowed. The flag is what turns a production demo boot from an
 * accident of a misconfigured environment into a deliberate, logged act.
 */
export function assertSeedAllowed(env: SeedEnv): void {
  const isProduction = env.NODE_ENV === 'production'
  const flagSet = env.DEVON_DEMO === '1'
  if (isProduction && !flagSet) {
    throw new SeedNotAllowedError()
  }
}

#!/usr/bin/env tsx
// `pnpm --filter @devon/db seed:demo:matrix` -- the one-command evidence producer for AC-2 (design §9):
// the (NODE_ENV × DEVON_DEMO) truth table, pasted verbatim as evidence. Needs no database at all --
// `assertSeedAllowed` is a pure function, and this is the whole point of making it one.
import { assertSeedAllowed, SeedNotAllowedError, type SeedEnv } from './guard.js'

const CASES: SeedEnv[] = [
  { NODE_ENV: undefined, DEVON_DEMO: undefined },
  { NODE_ENV: 'development', DEVON_DEMO: '0' },
  { NODE_ENV: 'development', DEVON_DEMO: '1' },
  { NODE_ENV: 'test', DEVON_DEMO: undefined },
  { NODE_ENV: 'production', DEVON_DEMO: undefined },
  { NODE_ENV: 'production', DEVON_DEMO: '0' },
  { NODE_ENV: 'production', DEVON_DEMO: '1' },
]

function expectedOutcome(c: SeedEnv): 'allowed' | 'refused' {
  return c.NODE_ENV === 'production' && c.DEVON_DEMO !== '1' ? 'refused' : 'allowed'
}

function actualOutcome(c: SeedEnv): 'allowed' | 'refused' {
  try {
    assertSeedAllowed(c)
    return 'allowed'
  } catch (err) {
    if (err instanceof SeedNotAllowedError) return 'refused'
    throw err
  }
}

console.log('NODE_ENV          DEVON_DEMO    outcome    expected')
let allMatch = true
for (const c of CASES) {
  const outcome = actualOutcome(c)
  const expected = expectedOutcome(c)
  const match = outcome === expected
  if (!match) allMatch = false
  console.log(
    `${(c.NODE_ENV ?? '(unset)').padEnd(18)} ${(c.DEVON_DEMO ?? '(unset)').padEnd(13)} ${outcome.padEnd(10)} ${expected}${match ? '' : '  <-- MISMATCH'}`,
  )
}

console.log(allMatch ? '\n[seed:demo:matrix] PASS' : '\n[seed:demo:matrix] FAIL')
process.exit(allMatch ? 0 : 1)

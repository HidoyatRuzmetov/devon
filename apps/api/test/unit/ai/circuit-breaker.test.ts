// H8.1: the `ai` circuit breaker (`lib/resilience/registry.ts`) as driven by
// `modules/ai/service.ts`'s `classifyAiOutcomeForBreaker` and `isAiAvailable`. `runFeatureForActor`
// itself needs a real Postgres connection (`withContext`) to exercise end to end -- exactly why this
// classification was pulled out into its own pure function (see that file's doc comment) -- so this
// test proves the breaker-driving decision and the breaker's own reaction to it, without a database.
import { afterEach, describe, expect, it } from 'vitest'
import { classifyAiOutcomeForBreaker, isAiAvailable } from '../../../src/modules/ai/service.js'
import {
  ai as aiBreaker,
  __resetAllCircuitsForTests,
} from '../../../src/lib/resilience/registry.js'

afterEach(() => {
  __resetAllCircuitsForTests()
})

describe('classifyAiOutcomeForBreaker', () => {
  it('is neutral when the input never reached the provider (meta is null)', () => {
    expect(classifyAiOutcomeForBreaker({ meta: null })).toBe('neutral')
  })

  it('fails on a provider_error status (the transport call itself failed)', () => {
    expect(classifyAiOutcomeForBreaker({ meta: { status: 'provider_error' } })).toBe('fail')
  })

  it.each(['ok', 'empty_after_retry', 'schema_invalid_after_retry'])(
    'succeeds on a %s status (GLM was reachable and answered)',
    (status) => {
      expect(classifyAiOutcomeForBreaker({ meta: { status } })).toBe('succeed')
    },
  )
})

describe('isAiAvailable / the ai breaker', () => {
  it('is available while the breaker is closed', () => {
    expect(isAiAvailable()).toBe(true)
  })

  it('becomes unavailable once the breaker trips, and available again once it later succeeds', () => {
    for (let i = 0; i < 10; i++) aiBreaker.fail(new Error('provider_error'))
    expect(isAiAvailable()).toBe(false)
    aiBreaker.reset() // simulate the reset window having passed and a probe succeeding
    aiBreaker.succeed()
    expect(isAiAvailable()).toBe(true)
  })
})

// H8.1: the `ai` circuit breaker (`lib/resilience/registry.ts`) as driven by
// `modules/ai/service.ts`'s `classifyAiOutcomeForBreaker` and `isAiAvailable`. `runFeatureForActor`
// itself needs a real Postgres connection (`withContext`) to exercise end to end -- exactly why this
// classification was pulled out into its own pure function (see that file's doc comment) -- so this
// test proves the breaker-driving decision and the breaker's own reaction to it, without a database.
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyAiOutcomeForBreaker,
  isAiAvailable,
  recordAiRunMetrics,
} from '../../../src/modules/ai/service.js'
import {
  ai as aiBreaker,
  __resetAllCircuitsForTests,
} from '../../../src/lib/resilience/registry.js'
import { aiCostUzsTotal, aiRequestDuration, aiTokensTotal } from '../../../src/lib/metrics.js'

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

describe('recordAiRunMetrics (H15.1 "AI latency/cost")', () => {
  it('records latency, cost and prompt/completion tokens under the feature+status labels', () => {
    const feature = `metrics-test-${Math.random().toString(36).slice(2)}`
    recordAiRunMetrics(feature, {
      status: 'ok',
      latencyMs: 1234,
      costUzs: 500,
      promptTokens: 100,
      completionTokens: 40,
    })

    expect(aiRequestDuration.render()).toContain(
      `devon_ai_request_duration_seconds_bucket{feature="${feature}",status="ok",le="+Inf"} 1`,
    )
    expect(aiRequestDuration.render()).toContain(
      `devon_ai_request_duration_seconds_sum{feature="${feature}",status="ok"} 1.234`,
    )
    expect(aiCostUzsTotal.render()).toContain(`devon_ai_cost_uzs_total{feature="${feature}"} 500`)
    expect(aiTokensTotal.render()).toContain(
      `devon_ai_tokens_total{feature="${feature}",kind="prompt"} 100`,
    )
    expect(aiTokensTotal.render()).toContain(
      `devon_ai_tokens_total{feature="${feature}",kind="completion"} 40`,
    )
  })

  it('a second call accumulates cost/tokens and adds a second latency observation', () => {
    const feature = `metrics-test-${Math.random().toString(36).slice(2)}`
    recordAiRunMetrics(feature, {
      status: 'provider_error',
      latencyMs: 8000,
      costUzs: 0,
      promptTokens: 10,
      completionTokens: 0,
    })
    recordAiRunMetrics(feature, {
      status: 'provider_error',
      latencyMs: 2000,
      costUzs: 0,
      promptTokens: 5,
      completionTokens: 0,
    })
    expect(aiTokensTotal.render()).toContain(
      `devon_ai_tokens_total{feature="${feature}",kind="prompt"} 15`,
    )
    expect(aiRequestDuration.render()).toContain(
      `devon_ai_request_duration_seconds_count{feature="${feature}",status="provider_error"} 2`,
    )
  })
})

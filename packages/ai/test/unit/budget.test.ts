import { describe, expect, it } from 'vitest'
import { canAffordCall, checkBudget, tokensToCostUzs } from '../../src/budget.js'

describe('tokensToCostUzs', () => {
  it('prices 1,000,000 tokens at the configured rate', () => {
    expect(tokensToCostUzs(1_000_000, 19_500)).toBe(19_500)
  })

  it('rounds to the nearest whole UZS', () => {
    expect(tokensToCostUzs(1234, 19_500)).toBe(Math.round((1234 / 1_000_000) * 19_500))
  })

  it('is zero for zero tokens', () => {
    expect(tokensToCostUzs(0)).toBe(0)
  })
})

describe('checkBudget', () => {
  it('is "ok" well under the soft cap', () => {
    const result = checkBudget(10_000, 1_000_000, 80)
    expect(result.status).toBe('ok')
    expect(result.remainingUzs).toBe(990_000)
  })

  it('is "soft_cap" at or above the soft cap percentage but under the hard cap', () => {
    const result = checkBudget(850_000, 1_000_000, 80)
    expect(result.status).toBe('soft_cap')
  })

  it('is "hard_stop" once spend reaches the cap', () => {
    const result = checkBudget(1_000_000, 1_000_000, 80)
    expect(result.status).toBe('hard_stop')
    expect(result.remainingUzs).toBe(0)
  })

  it('is "hard_stop" when no cap has been configured yet (cap = 0)', () => {
    const result = checkBudget(0, 0)
    expect(result.status).toBe('hard_stop')
  })

  it('never reports negative remaining budget even once spend exceeds the cap', () => {
    const result = checkBudget(1_500_000, 1_000_000)
    expect(result.remainingUzs).toBe(0)
    expect(result.status).toBe('hard_stop')
  })
})

describe('canAffordCall', () => {
  it('allows a call while spend is strictly under the cap', () => {
    expect(canAffordCall(999_999, 1_000_000)).toBe(true)
  })

  it('denies a call once spend has reached the cap', () => {
    expect(canAffordCall(1_000_000, 1_000_000)).toBe(false)
  })

  it('denies every call when no cap is configured', () => {
    expect(canAffordCall(0, 0)).toBe(false)
  })
})

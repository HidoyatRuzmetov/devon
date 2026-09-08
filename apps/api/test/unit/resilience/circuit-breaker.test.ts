// `src/lib/resilience/circuit-breaker.ts` (H8.1: timeouts and circuit breakers). Uses an injectable
// clock so state transitions across `resetTimeoutMs` are asserted deterministically, never with a real
// `setTimeout`/sleep.
import { describe, expect, it } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from '../../../src/lib/resilience/circuit-breaker.js'

function fakeClock(startAt = 0) {
  let now = startAt
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe('CircuitBreaker', () => {
  it('stays closed and lets every call through while calls keep succeeding', async () => {
    const breaker = new CircuitBreaker({ name: 't', failureThreshold: 3, resetTimeoutMs: 1000 })
    for (let i = 0; i < 10; i++) {
      await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
    }
    expect(breaker.snapshot().state).toBe('closed')
    expect(breaker.snapshot().consecutiveFailures).toBe(0)
  })

  it('trips to open after `failureThreshold` consecutive failures, then fails fast without calling fn', async () => {
    const breaker = new CircuitBreaker({ name: 't', failureThreshold: 3, resetTimeoutMs: 1000 })
    const boom = async () => {
      throw new Error('boom')
    }
    await expect(breaker.execute(boom)).rejects.toThrow('boom')
    await expect(breaker.execute(boom)).rejects.toThrow('boom')
    await expect(breaker.execute(boom)).rejects.toThrow('boom') // 3rd failure trips it
    expect(breaker.snapshot().state).toBe('open')

    let called = false
    await expect(breaker.execute(async () => (called = true))).rejects.toBeInstanceOf(
      CircuitOpenError,
    )
    expect(called).toBe(false) // never reached the dependency
  })

  it('a success resets the consecutive-failure count before the threshold trips', async () => {
    const breaker = new CircuitBreaker({ name: 't', failureThreshold: 3, resetTimeoutMs: 1000 })
    const boom = async () => {
      throw new Error('boom')
    }
    await expect(breaker.execute(boom)).rejects.toThrow()
    await expect(breaker.execute(boom)).rejects.toThrow()
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
    expect(breaker.snapshot().state).toBe('closed')
    await expect(breaker.execute(boom)).rejects.toThrow()
    await expect(breaker.execute(boom)).rejects.toThrow()
    // Only 2 consecutive since the reset -- still closed.
    expect(breaker.snapshot().state).toBe('closed')
  })

  it('allows exactly one half-open probe once resetTimeoutMs has passed, closing on success', async () => {
    const clock = fakeClock()
    const breaker = new CircuitBreaker({
      name: 't',
      failureThreshold: 1,
      resetTimeoutMs: 5000,
      now: clock.now,
    })
    await expect(
      breaker.execute(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow()
    expect(breaker.snapshot().state).toBe('open')

    // Still inside the reset window: fails fast.
    clock.advance(1000)
    await expect(breaker.execute(async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError)

    // Past the window: the probe runs for real and, on success, closes the breaker.
    clock.advance(4001)
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
    expect(breaker.snapshot().state).toBe('closed')
  })

  it('a failed half-open probe re-opens the breaker and restarts the reset window', async () => {
    const clock = fakeClock()
    const breaker = new CircuitBreaker({
      name: 't',
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: clock.now,
    })
    const boom = async () => {
      throw new Error('boom')
    }
    await expect(breaker.execute(boom)).rejects.toThrow()
    clock.advance(1001)
    await expect(breaker.execute(boom)).rejects.toThrow('boom') // the probe itself fails
    expect(breaker.snapshot().state).toBe('open')

    // Immediately after the failed probe, still open (window restarted).
    await expect(breaker.execute(async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('isCallAllowed reports state without mutating it', () => {
    const clock = fakeClock()
    const breaker = new CircuitBreaker({
      name: 't',
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: clock.now,
    })
    expect(breaker.isCallAllowed()).toBe(true)
  })

  it('reset() forces the breaker back to closed', async () => {
    const breaker = new CircuitBreaker({ name: 't', failureThreshold: 1, resetTimeoutMs: 60_000 })
    await expect(
      breaker.execute(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow()
    expect(breaker.snapshot().state).toBe('open')
    breaker.reset()
    expect(breaker.snapshot().state).toBe('closed')
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
  })
})

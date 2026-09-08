import { describe, expect, it } from 'vitest'
import { TimeoutError, withTimeout } from '../../../src/lib/resilience/timeout.js'

describe('withTimeout', () => {
  it('resolves with the promise value when it settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('rejects with TimeoutError when the promise never settles in time', async () => {
    const never = new Promise<never>(() => {})
    await expect(withTimeout(never, 20, 'slow-dependency')).rejects.toBeInstanceOf(TimeoutError)
    await expect(withTimeout(never, 20, 'slow-dependency')).rejects.toThrow(/slow-dependency/)
  })

  it('propagates a rejection that happens before the deadline', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 50)).rejects.toThrow('nope')
  })
})

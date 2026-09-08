// H9.1 (stampede protection): pure-logic coverage of `lib/single-flight.ts`'s coalescing behaviour --
// the analytics routes' use of it (`modules/analytics/index.ts`) needs a live department/summary
// computation to exercise end to end, so this is where its actual dedupe/no-staleness guarantees are
// verified directly.
import { describe, expect, it, vi } from 'vitest'
import { singleFlight } from '../../src/lib/single-flight.js'

describe('singleFlight', () => {
  it('runs the computation once for concurrent callers with the same key', async () => {
    let calls = 0
    const compute = vi.fn(async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'result'
    })

    const [a, b, c] = await Promise.all([
      singleFlight('key-a', compute),
      singleFlight('key-a', compute),
      singleFlight('key-a', compute),
    ])

    expect(calls).toBe(1)
    expect(a).toBe('result')
    expect(b).toBe('result')
    expect(c).toBe('result')
  })

  it('keeps different keys independent', async () => {
    const compute = vi.fn(async (n: number) => n * 2)
    const [a, b] = await Promise.all([
      singleFlight('x', () => compute(1)),
      singleFlight('y', () => compute(2)),
    ])
    expect(a).toBe(2)
    expect(b).toBe(4)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('recomputes on the next call after the in-flight one settles (never a stale TTL cache)', async () => {
    let n = 0
    const compute = vi.fn(async () => {
      n += 1
      return n
    })

    const first = await singleFlight('key-b', compute)
    const second = await singleFlight('key-b', compute)

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('does not poison the key on failure -- the next call gets a fresh attempt', async () => {
    let attempt = 0
    const compute = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('boom')
      return 'ok'
    })

    await expect(singleFlight('key-c', compute)).rejects.toThrow('boom')
    await expect(singleFlight('key-c', compute)).resolves.toBe('ok')
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

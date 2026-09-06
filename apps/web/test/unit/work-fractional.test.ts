import { describe, expect, it } from 'vitest'
import { keyBetween, keyForIndex } from '../../src/features/work/lib/fractional.js'

describe('keyBetween', () => {
  it('returns the shared "a0" first key when both bounds are null (matches the DB column default)', () => {
    expect(keyBetween(null, null)).toBe('a0')
  })

  it('sorts strictly between two existing keys', () => {
    const before = 'a0'
    const after = 'a1'
    const mid = keyBetween(before, after)
    expect(mid > before).toBe(true)
    expect(mid < after).toBe(true)
  })

  it('sorts after a key when there is no upper bound (append to end)', () => {
    const before = 'a5'
    const next = keyBetween(before, null)
    expect(next > before).toBe(true)
  })

  it('sorts before a key when there is no lower bound (insert at start)', () => {
    const after = 'a5'
    const prev = keyBetween(null, after)
    expect(prev < after).toBe(true)
  })

  it('keeps producing a valid midpoint under repeated insertion into the same gap', () => {
    const lo: string | null = 'a0'
    let hi: string | null = 'a1'
    for (let i = 0; i < 20; i += 1) {
      const mid = keyBetween(lo, hi)
      expect(mid > (lo ?? '')).toBe(true)
      expect(mid < (hi ?? '￿')).toBe(true)
      hi = mid // keep narrowing the upper half of the gap
    }
  })
})

describe('keyForIndex', () => {
  it('inserts at the start, middle and end of an existing sorted list', () => {
    const siblings = ['a1', 'a2', 'a3']
    const start = keyForIndex(siblings, 0)
    const middle = keyForIndex(siblings, 1)
    const end = keyForIndex(siblings, 3)
    expect(start < siblings[0]!).toBe(true)
    expect(middle > siblings[0]! && middle < siblings[1]!).toBe(true)
    expect(end > siblings[2]!).toBe(true)
  })

  it('returns "a0" for the first card in an empty column', () => {
    expect(keyForIndex([], 0)).toBe('a0')
  })
})

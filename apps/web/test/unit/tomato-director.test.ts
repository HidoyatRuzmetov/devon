import { describe, expect, it } from 'vitest'
import {
  TomatoDirector,
  TOMATO_ACTIVITIES,
  TOMATO_POOLS,
} from '../../src/features/personal/lib/tomato-director.js'

function randomSequence(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

describe('the tomato activity repertoire', () => {
  it('plays every focus activity before repeating and varies successive rounds', () => {
    const director = new TomatoDirector(randomSequence(52))
    const count = TOMATO_POOLS.focus.length
    const first = ['focus', ...Array.from({ length: count - 1 }, () => director.next('focus'))]
    expect(new Set(first).size).toBe(count)
    const second = Array.from({ length: count }, () => director.next('focus'))
    expect(new Set(second)).toEqual(new Set(TOMATO_POOLS.focus))
    expect(second).not.toEqual(first)
    expect(second[0]).not.toBe(first.at(-1))
  })

  it('never immediately repeats over hundreds of activities and phase changes', () => {
    const director = new TomatoDirector(randomSequence(9))
    let previous = 'focus'
    for (let i = 0; i < 400; i++) {
      const context = i % 19 < 13 ? 'focus' : 'break'
      const next = director.next(context)
      expect(next).not.toBe(previous)
      expect(TOMATO_POOLS[context]).toContain(next)
      previous = next
    }
  })

  it('preloading does not consume activities and unavailable optional sheets are skipped', () => {
    const director = new TomatoDirector(randomSequence(18))
    const next = director.peek('break')
    expect(director.peek('break')).toBe(next)
    director.exclude(next)
    expect(director.next('break')).not.toBe(next)
    for (let i = 0; i < 100; i++) expect(director.next('break')).not.toBe(next)
  })

  it('avoids immediate repeats when arbitrary phase changes leave one story in a bag', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = randomSequence(seed)
      const director = new TomatoDirector(random)
      let previous = 'focus'
      for (let index = 0; index < 1000; index++) {
        const next = director.next(random() < 0.5 ? 'focus' : 'break')
        expect(next).not.toBe(previous)
        previous = next
      }
    }
  })

  it('provides fifteen distinct 24-frame stories; completion is reserved for a completed timer', () => {
    expect(TOMATO_ACTIVITIES).toHaveLength(15)
    expect(new Set(TOMATO_ACTIVITIES).size).toBe(15)
    expect(TOMATO_POOLS.focus).not.toContain('complete')
    expect(TOMATO_POOLS.break).not.toContain('complete')
  })
})

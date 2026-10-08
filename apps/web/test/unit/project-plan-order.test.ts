import { describe, it, expect } from 'vitest'
import { generateKeyBetween } from 'fractional-indexing'
import { projectPlanRanks } from '../../src/features/projects/plan-order.js'
describe('accepted project plan ranks', () => {
  it('reuses existing project rank slots without changing other cards', () => {
    const cards = [
      { id: 'a', orderKey: 'a0' },
      { id: 'unrelated', orderKey: 'a1' },
      { id: 'b', orderKey: 'a2' },
    ]
    expect(projectPlanRanks(cards, ['b', 'a'])).toEqual([
      { id: 'b', orderKey: 'a0' },
      { id: 'a', orderKey: 'a2' },
    ])
    // An unrelated card at a1 remains between the occupied project slots.
    expect(cards.find((card) => card.id === 'unrelated')?.orderKey).toBe('a1')
  })
  it('repairs tied or legacy ranks to valid fractional indices, and drops missing/repeated tasks', () => {
    for (const orderKey of ['a0', 'p0000']) {
      const ranks = projectPlanRanks(
        [
          { id: 'a', orderKey },
          { id: 'b', orderKey },
        ],
        ['b', 'missing', 'a', 'b'],
      )
      expect(ranks.map((x) => x.id)).toEqual(['b', 'a'])
      expect(ranks[0]!.orderKey < ranks[1]!.orderKey).toBe(true)
      for (const rank of ranks) expect(() => generateKeyBetween(rank.orderKey, null)).not.toThrow()
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { fetchMemberHomeCards, sortMemberTasks } from '../../src/features/home/member-overview.js'
import type { Card } from '../../src/features/work/api.js'
const fetchCards = vi.hoisted(() => vi.fn())
vi.mock('../../src/features/work/api.js', async (original) => ({
  ...(await original<object>()),
  fetchCards,
}))
describe('member Home data', () => {
  it('follows all own-card pages instead of silently truncating at 100', async () => {
    fetchCards
      .mockReset()
      .mockResolvedValueOnce({ items: [{ id: 'first' }], nextCursor: 'second-page' })
      .mockResolvedValueOnce({ items: [{ id: 'last' }], nextCursor: null })
    expect(await fetchMemberHomeCards()).toEqual([{ id: 'first' }, { id: 'last' }])
    expect(fetchCards).toHaveBeenNthCalledWith(2, {
      q: 'assignee:@me',
      limit: 100,
      cursor: 'second-page',
    })
  })
  it('stops fetching after account navigation cancels the query', async () => {
    const controller = new AbortController()
    fetchCards.mockReset().mockImplementationOnce(async () => {
      controller.abort()
      return { items: [], nextCursor: 'more' }
    })
    await expect(fetchMemberHomeCards(controller.signal)).rejects.toThrow()
    expect(fetchCards).toHaveBeenCalledOnce()
  })
  it('orders pinned work then overdue work then dated work without treating missing dates as today', () => {
    const card = (id: string, overrides: Partial<Card> = {}) =>
      ({
        id,
        dueAt: null,
        focusPinned: false,
        risk: 'none',
        priority: 'none',
        orderKey: id,
        ...overrides,
      }) as Card
    const cards = [
      card('undated', { priority: 'urgent' }),
      card('later', { dueAt: '2026-11-01T00:00:00Z' }),
      card('overdue', { risk: 'overdue', dueAt: '2026-10-01T00:00:00Z' }),
      card('pinned', { focusPinned: true }),
    ]
    expect(sortMemberTasks(cards).map((item) => item.id)).toEqual([
      'pinned',
      'overdue',
      'later',
      'undated',
    ])
    expect(cards[0]?.id).toBe('undated')
  })
})

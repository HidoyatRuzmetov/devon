import { describe, expect, it, vi } from 'vitest'
import {
  fetchMemberHomeCards,
  sortMemberTasks,
  memberCardsForCategory,
} from '../../src/features/home/member-overview.js'
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
  it('orders nearest deadlines then priority; a focus pin never hides earlier work', () => {
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
      'overdue',
      'later',
      'undated',
      'pinned',
    ])
    expect(cards[0]?.id).toBe('undated')
  })
  it('separates project assignments without losing origin when filtering or reviewing completed cards', () => {
    const make = (id: string, status: string, projectId: string | null, workStage = 'todo') =>
      ({ id, status, projectId, workStage, priority: 'none', orderKey: id }) as Card
    const cards = [
      make('individual', 'active', null),
      make('project', 'active', 'group', 'in_progress'),
      make('done-project', 'done', 'group'),
      make('archived-individual', 'archived', null),
    ]
    expect(memberCardsForCategory(cards, 'individual', 'all').map((c) => c.id)).toEqual([
      'individual',
    ])
    expect(memberCardsForCategory(cards, 'projects', 'in_progress').map((c) => c.id)).toEqual([
      'project',
    ])
    expect(memberCardsForCategory(cards, 'individual', 'in_progress')).toEqual([])
    expect(memberCardsForCategory(cards, 'done', 'todo').map((c) => c.id)).toEqual(['done-project'])
    expect(memberCardsForCategory(cards, 'archived', 'all').map((c) => c.id)).toEqual([
      'archived-individual',
    ])
  })
})

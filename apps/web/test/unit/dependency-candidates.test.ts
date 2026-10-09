import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCards, type Card } from '../../src/features/work/api.js'
import { fetchDependencyCandidates } from '../../src/features/work/dependency-candidates.js'

vi.mock('../../src/features/work/api.js', () => ({ fetchCards: vi.fn() }))

function card(id: string, title = id): Card {
  return {
    id,
    title,
    kind: 'task',
    description: null,
    assigneeUserId: null,
    giverUserId: null,
    projectId: null,
    projectScope: 'none',
    status: 'active',
    priority: 'none',
    risk: 'none',
    startAt: null,
    dueAt: null,
    doneAt: null,
    archivedAt: null,
    orderKey: id,
    labels: [],
    watchers: [],
    links: [],
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    createdByUserId: 'creator',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    version: 1,
  }
}

beforeEach(() => vi.mocked(fetchCards).mockReset())

describe('complete dependency candidates', () => {
  it('follows every cursor and deduplicates cards across changing pages', async () => {
    vi.mocked(fetchCards)
      .mockResolvedValueOnce({ items: [card('a')], nextCursor: 'page-two' })
      .mockResolvedValueOnce({ items: [card('a', 'updated'), card('b')], nextCursor: 'page-three' })
      .mockResolvedValueOnce({ items: [card('c')], nextCursor: null })
    const result = await fetchDependencyCandidates()
    expect(result.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'a', title: 'updated' },
      { id: 'b', title: 'b' },
      { id: 'c', title: 'c' },
    ])
    expect(vi.mocked(fetchCards).mock.calls).toEqual([
      [{ limit: 100, cursor: undefined }],
      [{ limit: 100, cursor: 'page-two' }],
      [{ limit: 100, cursor: 'page-three' }],
    ])
  })

  it('rejects a later-page refusal without returning a partial candidate list', async () => {
    const refusal = new Error('local later page refusal')
    vi.mocked(fetchCards)
      .mockResolvedValueOnce({ items: [card('a')], nextCursor: 'page-two' })
      .mockRejectedValueOnce(refusal)
    await expect(fetchDependencyCandidates()).rejects.toBe(refusal)
    expect(fetchCards).toHaveBeenCalledTimes(2)
  })

  it('refuses a repeated cursor instead of fetching indefinitely', async () => {
    vi.mocked(fetchCards)
      .mockResolvedValueOnce({ items: [card('a')], nextCursor: 'same' })
      .mockResolvedValueOnce({ items: [card('b')], nextCursor: 'same' })
    await expect(fetchDependencyCandidates()).rejects.toThrow('Card pagination did not advance')
    expect(fetchCards).toHaveBeenCalledTimes(2)
  })
})

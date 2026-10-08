import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Board, Card } from '../../src/features/work/api.js'
import {
  focusFirst,
  moveCardOnBoard,
  previousBoardPosition,
  sortBoardCards,
} from '../../src/features/work/lib/board-state.js'
import {
  patchCardInCaches,
  useMoveCardMutation,
  usePatchChecklistItemMutation,
} from '../../src/features/work/hooks.js'

const mocks = vi.hoisted(() => ({ move: vi.fn(), checklist: vi.fn() }))
vi.mock('../../src/features/work/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  moveCard: mocks.move,
  patchChecklistItem: mocks.checklist,
}))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({ data: { csrfToken: 'dummy-csrf-token' } }),
}))
vi.mock('../../src/lib/realtime/index.js', () => ({ useIsLive: () => false }))

function card(id: string, assigneeUserId: string, orderKey: string): Card {
  return {
    id,
    title: id,
    assigneeUserId,
    orderKey,
    kind: 'task',
    projectId: null,
    projectScope: 'none',
    status: 'active',
    description: null,
    giverUserId: null,
    priority: 'none',
    risk: 'none',
    startAt: null,
    dueAt: null,
    doneAt: null,
    archivedAt: null,
    labels: [],
    watchers: [],
    links: [],
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    createdByUserId: 'head',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
  }
}
function board(): Board {
  const member = (userId: string) => ({
    userId,
    givenName: userId,
    familyName: '',
    title: null,
    avatarKey: null,
    role: 'member' as const,
    unitId: null,
    unitName: null,
  })
  return {
    members: ['a', 'b', 'c'].map(member),
    labels: [],
    unassigned: [],
    columns: [
      { member: member('a'), cards: [card('a1', 'a', 'a0'), card('a2', 'a', 'a1')] },
      { member: member('b'), cards: [card('b1', 'b', 'a0'), card('b2', 'b', 'a1')] },
      { member: member('c'), cards: [card('c1', 'c', 'a0'), card('c2', 'c', 'a1')] },
    ],
  }
}
function ids(value: Board, column: string) {
  return value.columns.find((item) => item.member.userId === column)!.cards.map((item) => item.id)
}
const clients: QueryClient[] = []
afterEach(() => {
  for (const client of clients) client.clear()
  clients.length = 0
  vi.clearAllMocks()
})
function client() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(qc)
  qc.setQueryData(['work', 'board'], board())
  return qc
}

describe('board move and focus cache', () => {
  it('moves the actual arrays around current target IDs and leaves unrelated columns unchanged', () => {
    const original = board()
    const moved = moveCardOnBoard(original, {
      id: 'a2',
      toUserId: 'b',
      targetCardId: 'b1',
      edge: 'before',
    })
    expect(ids(moved, 'a')).toEqual(['a1'])
    expect(ids(moved, 'b')).toEqual(['a2', 'b1', 'b2'])
    expect(moved.columns[2]).toBe(original.columns[2])
    const twice = moveCardOnBoard(moved, {
      id: 'b2',
      toUserId: 'b',
      targetCardId: 'a2',
      edge: 'before',
    })
    expect(ids(twice, 'b')).toEqual(['b2', 'a2', 'b1'])
    expect(ids(twice, 'a')).toEqual(['a1'])
  })
  it('puts the newest personal focus pin first and restores shared rank when unpinned', () => {
    const cards = [
      card('first', 'a', 'a0'),
      card('middle', 'a', 'a1'),
      { ...card('last', 'a', 'a2'), focusPinned: true, focusPosition: 0 },
    ]
    expect(focusFirst(cards).map((item) => item.id)).toEqual(['last', 'first', 'middle'])
    const unpinned = focusFirst(cards).map((item) => ({
      ...item,
      focusPinned: false,
      focusPosition: null,
    }))
    expect(sortBoardCards(unpinned).map((item) => item.id)).toEqual(['first', 'middle', 'last'])
  })
  it('rolls back only changed card fields while another card edit and move survive', () => {
    const qc = client()
    const failed = patchCardInCaches(qc, 'a1', { title: 'Failed title' })
    patchCardInCaches(qc, 'c1', { title: 'Successful title' })
    qc.setQueryData<Board>(['work', 'board'], (current) =>
      moveCardOnBoard(current!, { id: 'b1', toUserId: 'c', targetCardId: 'c2', edge: 'before' }),
    )
    failed.rollback()
    const result = qc.getQueryData<Board>(['work', 'board'])!
    expect(result.columns[0]!.cards[0]!.title).toBe('a1')
    expect(result.columns[2]!.cards[0]!.title).toBe('Successful title')
    expect(ids(result, 'c')).toEqual(['c1', 'b1', 'c2'])
  })
  it('relocates a card edited through its assignee field and restores its original place on refusal', () => {
    const qc = client()
    const failed = patchCardInCaches(qc, 'a1', { assigneeUserId: 'b' })
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'a')).toEqual(['a2'])
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'b')).toEqual(['b1', 'b2', 'a1'])
    failed.rollback()
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'a')).toEqual(['a1', 'a2'])
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'b')).toEqual(['b1', 'b2'])
  })
  it('removes finished work immediately and restores only that card if the server refuses', () => {
    const qc = client()
    const failed = patchCardInCaches(qc, 'a1', { status: 'done' })
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'a')).toEqual(['a2'])
    patchCardInCaches(qc, 'b1', { title: 'Unrelated edit' })
    failed.rollback()
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'a')).toEqual(['a1', 'a2'])
    expect(qc.getQueryData<Board>(['work', 'board'])!.columns[1]!.cards[0]!.title).toBe(
      'Unrelated edit',
    )
  })
  it('keeps a second optimistic drag visible when the first drag is rejected', async () => {
    const qc = client()
    let rejectFirst!: (reason: Error) => void
    let resolveSecond!: (value: Card) => void
    mocks.move
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useMoveCardMutation(), { wrapper })
    act(() => {
      result.current.mutate({ id: 'a1', toUserId: 'b', targetCardId: 'b1', edge: 'before' })
      result.current.mutate({ id: 'a2', toUserId: 'c', targetCardId: 'c2', edge: 'before' })
    })
    await waitFor(() =>
      expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'c')).toEqual(['c1', 'a2', 'c2']),
    )
    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1))
    act(() => rejectFirst(new Error('Refused first move')))
    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(2))
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'a')).toEqual(['a1'])
    expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'c')).toEqual(['c1', 'a2', 'c2'])
    act(() => resolveSecond(card('a2', 'c', 'a0V')))
    await waitFor(() => expect(result.current.isPending).toBe(false))
  })
  it('captures stable neighbour IDs for rollback after unrelated positions change', () => {
    expect(previousBoardPosition(board(), 'a1')).toEqual({
      id: 'a1',
      toUserId: 'a',
      targetCardId: 'a2',
      edge: 'before',
    })
    expect(previousBoardPosition(board(), 'a2')).toEqual({
      id: 'a2',
      toUserId: 'a',
      targetCardId: 'a1',
      edge: 'after',
    })
  })
  it('moves orphan cards from their actual Unassigned bucket without duplicating or losing the original assignee on refusal', () => {
    const qc = client()
    const original = {
      ...board(),
      unassigned: [{ ...card('orphan', 'removed-member', 'a0'), assigneeUnavailable: true }],
    }
    qc.setQueryData(['work', 'board'], original)
    const moved = moveCardOnBoard(original, {
      id: 'orphan',
      toUserId: 'b',
      targetCardId: 'b1',
      edge: 'before',
    })
    expect(moved.unassigned).toEqual([])
    expect(ids(moved, 'b')).toEqual(['orphan', 'b1', 'b2'])
    expect(moved.columns[1]!.cards[0]!.assigneeUnavailable).toBe(false)
    const failed = patchCardInCaches(qc, 'orphan', { status: 'done' })
    expect(qc.getQueryData<Board>(['work', 'board'])!.unassigned).toEqual([])
    failed.rollback()
    expect(qc.getQueryData<Board>(['work', 'board'])!.unassigned[0]).toMatchObject({
      id: 'orphan',
      assigneeUserId: 'removed-member',
      assigneeUnavailable: true,
    })
  })
  for (const firstToSettle of ['move', 'checklist'] as const) {
    it(`waits for both board/checklist writes before refreshing when ${firstToSettle} finishes first`, async () => {
      const qc = client()
      qc.setQueryData(['work', 'card', 'c1'], {
        ...card('c1', 'c', 'a0'),
        checklist: [
          {
            id: 'check',
            cardId: 'c1',
            parentItemId: null,
            text: 'Pending check',
            doneAt: null,
            assigneeUserId: null,
            dueAt: null,
            orderKey: 'a0',
            version: 1,
          },
        ],
        comments: [],
        activity: [],
      })
      let finishMove!: (value: Card) => void
      let finishChecklist!: () => void
      mocks.move.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishMove = resolve
          }),
      )
      mocks.checklist.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishChecklist = resolve
          }),
      )
      const invalidate = vi.spyOn(qc, 'invalidateQueries')
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(
        () => ({ move: useMoveCardMutation(), checklist: usePatchChecklistItemMutation('c1') }),
        { wrapper },
      )
      act(() => {
        result.current.move.mutate({ id: 'a1', toUserId: 'b', targetCardId: 'b1', edge: 'before' })
        result.current.checklist.mutate({ itemId: 'check', patch: { done: true } })
      })
      await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(mocks.checklist).toHaveBeenCalledTimes(1))
      act(() => (firstToSettle === 'move' ? finishMove(card('a1', 'b', 'Zz')) : finishChecklist()))
      await waitFor(() => expect(result.current[firstToSettle].isPending).toBe(false))
      expect(invalidate).not.toHaveBeenCalled()
      expect(ids(qc.getQueryData<Board>(['work', 'board'])!, 'b')[0]).toBe('a1')
      expect(
        qc.getQueryData<{ checklist: { doneAt: string | null }[] }>(['work', 'card', 'c1'])!
          .checklist[0]!.doneAt,
      ).not.toBeNull()
      act(() => (firstToSettle === 'move' ? finishChecklist() : finishMove(card('a1', 'b', 'Zz'))))
      await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2))
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects'] })
    })
  }
})

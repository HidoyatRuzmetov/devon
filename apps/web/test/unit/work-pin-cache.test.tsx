import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../../src/features/work/api.js'
import {
  useAddFocusMutation,
  usePersonPinMutation,
  useRemoveFocusMutation,
} from '../../src/features/work/hooks-plus.js'

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }))
vi.mock('../../src/features/work/api-plus.js', async (original) => ({
  ...(await original()),
  addFocusPin: mocks.add,
  removeFocusPin: mocks.remove,
}))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({
    data: { user: { id: 'self' }, csrfToken: 'synthetic-test-token' }, // Dummy hook-test CSRF value.
  }),
}))
vi.mock('../../src/lib/realtime/index.js', () => ({ useIsLive: () => false }))

function card(assigneeUserId: string, pinned = true): Card {
  return {
    id: 'task',
    title: 'Task',
    kind: 'task',
    description: null,
    assigneeUserId,
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
    orderKey: 'a0',
    labels: [],
    watchers: [],
    links: [],
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    createdByUserId: 'self',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    focusPinned: pinned,
    focusPosition: pinned ? 0 : null,
    assigneePinned: pinned,
    assigneePinPosition: pinned ? 0 : null,
  }
}

const clients: QueryClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.clearAllMocks()
})
function setup(row: Card) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const key = ['work', 'cards', 'person', 'department', 'self', row.assigneeUserId]
  client.setQueryData(key, [row])
  vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return {
    client,
    wrapper,
    current: () => client.getQueryData<Card[]>(key)![0]!,
  }
}

describe('personal and assignee pin cache identity', () => {
  it('unpins own task immediately on the person-only cache, and restores both flags if refused', async () => {
    let refuse!: (error: Error) => void
    mocks.remove.mockReturnValue(
      new Promise((_, reject) => {
        refuse = reject
      }),
    )
    const view = setup(card('self'))
    const { result } = renderHook(() => useRemoveFocusMutation(), {
      wrapper: view.wrapper,
    })
    act(() => result.current.mutate('task'))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce())
    expect(view.current()).toMatchObject({
      focusPinned: false,
      assigneePinned: false,
    })
    await act(async () => refuse(new Error('Permission changed')))
    await waitFor(() =>
      expect(view.current()).toMatchObject({
        focusPinned: true,
        assigneePinned: true,
      }),
    )
  })

  it('removing a private personal pin does not clear the other assignee’s shared pin', async () => {
    mocks.remove.mockResolvedValue(undefined)
    const view = setup(card('colleague'))
    const { result } = renderHook(() => useRemoveFocusMutation(), {
      wrapper: view.wrapper,
    })
    await act(async () => result.current.mutateAsync('task'))
    expect(view.current()).toMatchObject({
      focusPinned: false,
      assigneePinned: true,
    })
  })

  it('adding own pin updates its shared identity even when no board or drawer is cached', async () => {
    mocks.add.mockResolvedValue(undefined)
    const view = setup(card('self', false))
    const { result } = renderHook(() => useAddFocusMutation(), {
      wrapper: view.wrapper,
    })
    await act(async () => result.current.mutateAsync('task'))
    expect(view.current()).toMatchObject({
      focusPinned: true,
      assigneePinned: true,
    })
  })

  it('head pinning a colleague changes only that assignee’s shared flag', async () => {
    mocks.add.mockResolvedValue(undefined)
    const view = setup(card('colleague', false))
    const { result } = renderHook(() => usePersonPinMutation('colleague'), {
      wrapper: view.wrapper,
    })
    await act(async () => result.current.mutateAsync({ cardId: 'task', pinned: true }))
    expect(mocks.add).toHaveBeenCalledWith('task', 'synthetic-test-token', 'colleague')
    expect(view.current()).toMatchObject({
      focusPinned: false,
      assigneePinned: true,
    })
  })
})

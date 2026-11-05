import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ChecklistItem } from '../../src/features/work/api.js'
import { usePatchChecklistItemMutation } from '../../src/features/work/hooks.js'

const patch = vi.hoisted(() => vi.fn())
vi.mock('../../src/features/work/api.js', async (original) => ({
  ...(await original()),
  patchChecklistItem: patch,
}))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({ data: { csrfToken: 'test-token' } }), // Dummy CSRF value for this isolated hook test.
}))
vi.mock('../../src/lib/realtime/index.js', () => ({ useIsLive: () => false }))

it('updates the project batch immediately and rolls back only failed fields, preserving other work and new comments', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const items: ChecklistItem[] = ['first', 'second'].map((id) => ({
    id,
    cardId: 'card',
    parentItemId: null,
    text: id,
    doneAt: null,
    assigneeUserId: null,
    dueAt: null,
    orderKey: id,
    version: 1,
    commentCount: 0,
  }))
  const key = ['work', 'checklist-batch', ['card']]
  client.setQueryData(key, items)
  let reject!: (error: Error) => void
  patch.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail
      }),
  )
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => usePatchChecklistItemMutation('card'), { wrapper })
  try {
    act(() => hook.result.current.mutate({ itemId: 'first', patch: { done: true } }))
    await waitFor(() =>
      expect(client.getQueryData<ChecklistItem[]>(key)![0]!.doneAt).not.toBeNull(),
    )
    act(() =>
      client.setQueryData<ChecklistItem[]>(key, (current) =>
        current!.map((item) =>
          item.id === 'first'
            ? { ...item, commentCount: 3 }
            : { ...item, doneAt: '2026-11-05T10:00:00Z' },
        ),
      ),
    )
    act(() => reject(new Error('locked concurrently')))
    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(client.getQueryData<ChecklistItem[]>(key)![0]).toMatchObject({
      doneAt: null,
      commentCount: 3,
    })
    expect(client.getQueryData<ChecklistItem[]>(key)![1]!.doneAt).toBe('2026-11-05T10:00:00Z')
  } finally {
    hook.unmount()
    client.clear()
  }
})

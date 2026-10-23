import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useNotificationFeed } from '../../src/features/inbox/hooks.js'
const fetchNotifications = vi.hoisted(() => vi.fn())
vi.mock('../../src/features/inbox/api.js', async (original) => ({
  ...(await original<object>()),
  fetchNotifications,
}))
describe('Home inbox pagination', () => {
  it('reaches the next cursor and refreshes loaded pages after a notification change', async () => {
    let unread = 2
    fetchNotifications
      .mockReset()
      .mockImplementation(async (_status, cursor) =>
        cursor === 'older'
          ? { items: [{ id: 'older' }], unreadCount: unread, nextCursor: null }
          : { items: [{ id: 'newest' }], unreadCount: unread, nextCursor: 'older' },
      )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useNotificationFeed('inbox'), { wrapper })
    await waitFor(() =>
      expect(hook.result.current.data?.items.map((item) => item.id)).toEqual(['newest']),
    )
    await act(async () => {
      await hook.result.current.fetchNextPage()
    })
    await waitFor(() =>
      expect(hook.result.current.data?.items.map((item) => item.id)).toEqual(['newest', 'older']),
    )
    expect(hook.result.current.hasNextPage).toBe(false)
    unread = 1
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['inbox', 'notifications'] })
    })
    await waitFor(() => expect(hook.result.current.data?.unreadCount).toBe(1))
    expect(hook.result.current.data?.items.map((item) => item.id)).toEqual(['newest', 'older'])
    hook.unmount()
    client.clear()
  })
  it('refreshes only the visible feed when realtime is disconnected', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchNotifications
      .mockReset()
      .mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(({ active }) => useNotificationFeed('inbox', active), {
      wrapper,
      initialProps: { active: true },
    })
    try {
      await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
      const options = () =>
        client.getQueryCache().find({ queryKey: ['inbox', 'notifications', 'inbox', 'feed'] })
          ?.options as { refetchInterval?: number | false }
      expect(options().refetchInterval).toBe(60_000)
      hook.rerender({ active: false })
      expect(options().refetchInterval).toBe(false)
    } finally {
      hook.unmount()
      client.clear()
    }
  })
})

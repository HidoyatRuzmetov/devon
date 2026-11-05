import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useRestoreProjectAndCardMutation } from '../../src/features/projects/hooks.js'

const mocks = vi.hoisted(() => ({ group: vi.fn(), card: vi.fn() }))
vi.mock('../../src/features/projects/api.js', async (original) => ({
  ...(await original()),
  restoreProject: mocks.group,
}))
vi.mock('../../src/features/work/api.js', async (original) => ({
  ...(await original()),
  restoreCard: mocks.card,
}))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({ data: { csrfToken: 'synthetic-local-test' } }), // Dummy CSRF value, never sent to a server.
}))
const clients: QueryClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.clearAllMocks()
})
function show() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  clients.push(client)
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useRestoreProjectAndCardMutation(), { wrapper }) }
}
it('recovers the selected independently deleted card only after its parent becomes available', async () => {
  let finish!: () => void
  mocks.group.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  mocks.card.mockResolvedValue(undefined)
  const { result } = show()
  act(() => result.current.mutate({ projectId: 'group', cardId: 'individually-deleted-card' }))
  await waitFor(() => expect(mocks.group).toHaveBeenCalledWith('group', 'synthetic-local-test'))
  expect(mocks.card).not.toHaveBeenCalled()
  await act(async () => finish())
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(mocks.card).toHaveBeenCalledExactlyOnceWith(
    'individually-deleted-card',
    'synthetic-local-test',
  )
})
it('refreshes partial group recovery when the requested card cannot be restored', async () => {
  mocks.group.mockResolvedValue(undefined)
  mocks.card.mockRejectedValue(new Error('Card ownership changed'))
  const { client, result } = show()
  client.setQueryData(['work', 'cards', 'person'], ['stale'])
  client.setQueryData(['projects', 'list'], ['stale'])
  await act(async () => {
    await expect(
      result.current.mutateAsync({ projectId: 'group', cardId: 'card' }),
    ).rejects.toThrow('Card ownership changed')
  })
  expect(client.getQueryState(['work', 'cards', 'person'])?.isInvalidated).toBe(true)
  expect(client.getQueryState(['projects', 'list'])?.isInvalidated).toBe(true)
})

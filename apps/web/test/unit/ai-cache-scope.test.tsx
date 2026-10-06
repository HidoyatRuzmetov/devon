import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const state = vi.hoisted(() => ({ departmentId: 'department-a', userId: 'head-a' }))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({
    data: {
      user: { id: state.userId },
      activeDepartmentId: state.departmentId,
      memberships: [],
      actingForUserId: null,
    },
  }),
}))
vi.mock('../../src/features/ai/api.js', () => ({
  fetchAiSettings: vi.fn(async () => ({
    departmentId: state.departmentId,
    budgetUzsPerMonth: state.departmentId === 'department-a' ? 1000 : 2000,
  })),
}))

import { useAiSettingsQuery } from '../../src/features/ai/use-ai.js'
import { fetchAiSettings } from '../../src/features/ai/api.js'

describe('AI cache isolation', () => {
  it('does not serve the previous department’s budget after a switch, even while its cache is fresh', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result, rerender, unmount } = renderHook(() => useAiSettingsQuery(), { wrapper })
    await waitFor(() => expect(result.current.data?.departmentId).toBe('department-a'))
    state.departmentId = 'department-b'
    rerender()
    expect(result.current.data?.departmentId).not.toBe('department-a')
    await waitFor(() => expect(result.current.data?.departmentId).toBe('department-b'))
    expect(fetchAiSettings).toHaveBeenCalledTimes(2)
    state.userId = 'member-b'
    rerender()
    await waitFor(() => expect(fetchAiSettings).toHaveBeenCalledTimes(3))
    unmount()
    client.clear()
  })
})

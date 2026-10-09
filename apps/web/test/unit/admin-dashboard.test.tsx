import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
vi.mock('../../src/features/admin/admin-screen.js', () => ({
  AdminScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../../src/features/departments/api.js', () => ({
  fetchAllRequests: vi.fn().mockResolvedValue({ requests: [] }),
}))
vi.mock('../../src/features/admin/api.js', () => ({
  fetchAdminInstanceDetail: vi
    .fn()
    .mockResolvedValue({ isDemo: true, registrationOpen: true, userCount: 2 }),
  fetchMaintenance: vi.fn().mockResolvedValue({ enabled: false, message: null }),
  fetchAdminHealth: vi.fn().mockRejectedValue(new Error('Local unavailable health')),
  fetchAdminDepartments: vi.fn(),
}))
import { fetchAdminDepartments } from '../../src/features/admin/api.js'
import DashboardScreen from '../../src/features/admin/dashboard-screen.js'
it('makes every department breakdown page reachable and preserves earlier rows', async () => {
  setLocale('en')
  const row = (id: string, name: string) => ({
    id,
    name,
    slug: name,
    status: 'active' as const,
    memberCount: 1,
    headName: null,
    createdAt: '2026-10-08T00:00:00Z',
  })
  vi.mocked(fetchAdminDepartments)
    .mockResolvedValueOnce({
      departments: [row('00000000-0000-4000-a000-000000000001', 'First department')],
      nextCursor: '2026-10-08T00:00:00Z|00000000-0000-4000-a000-000000000001',
    })
    .mockResolvedValue({
      departments: [row('00000000-0000-4000-a000-000000000002', 'Last department')],
      nextCursor: null,
    })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DashboardScreen />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'By department' }))
  expect(await screen.findByText('First department')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'More departments' }))
  expect(await screen.findByText('Last department')).toBeVisible()
  expect(screen.getByText('First department')).toBeVisible()
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'More departments' })).not.toBeInTheDocument(),
  )
  expect(fetchAdminDepartments).toHaveBeenLastCalledWith({
    cursor: '2026-10-08T00:00:00Z|00000000-0000-4000-a000-000000000001',
  })
  client.clear()
})

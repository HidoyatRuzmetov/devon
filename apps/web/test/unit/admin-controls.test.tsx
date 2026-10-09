import * as React from 'react'
import type * as UI from '@devon/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale, translate, LOCALES } from '@devon/i18n'
vi.mock('@devon/ui', async (original) => ({
  ...(await original<typeof UI>()),
  toast: vi.fn(),
}))
import { toast } from '@devon/ui'
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({
    data: { csrfToken: qaExampleCredential1, user: { id: 'fixture-admin', role: 'super_admin' } },
    refetch: vi.fn(),
  }),
}))
vi.mock('../../src/features/admin/admin-screen.js', () => ({
  AdminScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../../src/features/admin/api.js', () => ({
  fetchAuditEvents: vi.fn(),
  fetchAuditVerify: vi.fn(),
  stopViewAs: vi.fn(),
  fetchAuditExport: vi.fn(),
}))
import {
  fetchAuditEvents,
  fetchAuditVerify,
  stopViewAs,
  fetchAuditExport,
} from '../../src/features/admin/api.js'
import { ApiError } from '../../src/lib/api-client.js'
import AuditScreen from '../../src/features/admin/audit-screen.js'
import { ViewAsBanner } from '../../src/features/admin/view-as-banner.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'local-csrf'

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
})
it.each(['verify', 'exit'] as const)(
  'reports a failed admin control without claiming success: %s',
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(fetchAuditEvents).mockResolvedValue({ events: [], nextCursor: null })
    vi.mocked(fetchAuditVerify).mockRejectedValue(new Error('Local verify unavailable'))
    vi.mocked(stopViewAs).mockRejectedValue(new Error('Local exit unavailable'))
    render(
      <QueryClientProvider client={client}>
        {kind === 'verify' ? <AuditScreen /> : <ViewAsBanner />}
      </QueryClientProvider>,
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: kind === 'verify' ? 'Verify chain' : 'Exit view-as',
      }),
    )
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(kind === 'verify' ? fetchAuditVerify : stopViewAs).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('The change could not be saved. Try again.')
    expect(screen.queryByText('Chain intact')).not.toBeInTheDocument()
    client.clear()
  },
)
it('shows oversized-export guidance and preserves the audit screen and filters for recovery', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.mocked(fetchAuditEvents).mockResolvedValue({ events: [], nextCursor: null })
  vi.mocked(fetchAuditExport).mockRejectedValue(
    new ApiError(422, 'validation_failed', 'local-qa', [
      { path: 'export', code: 'too_many_events' },
    ]),
  )
  render(
    <QueryClientProvider client={client}>
      <AuditScreen />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('From date'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-08' } })
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
  await waitFor(() =>
    expect(fetchAuditExport).toHaveBeenCalledWith(undefined, {
      from: new Date('2026-10-01T00:00:00').toISOString(),
      to: new Date('2026-10-08T23:59:59.999').toISOString(),
    }),
  )
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      'This export has too many events. Choose a category or a shorter date range, then try again.',
    ),
  )
  expect(screen.getByLabelText('From date')).toHaveValue('2026-10-01')
  expect(screen.getByLabelText('To date')).toHaveValue('2026-10-08')
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
  client.clear()
})

it.each(LOCALES)(
  'known department transitions and personal restores use readable audit phrases in %s',
  async (locale) => {
    setLocale(locale)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const actions = [
      'admin.department.paused',
      'admin.department.restored',
      'personal.task.restored',
      'notifications.restored',
    ]
    vi.mocked(fetchAuditEvents).mockResolvedValue({
      events: actions.map((action, index) => ({
        seq: index + 1,
        id: `00000000-0000-4000-8000-00000000000${index}`,
        at: '2026-10-08T08:00:00Z',
        actorUserId: null,
        actorRole: 'super_admin',
        actorName: 'Fixture administrator',
        departmentId: null,
        action,
        subjectType: 'user',
        subjectId: null,
      })),
      nextCursor: null,
    })
    render(
      <QueryClientProvider client={client}>
        <AuditScreen />
      </QueryClientProvider>,
    )
    for (const action of actions) {
      const alias = action === 'personal.task.restored' ? 'personal.item.restored' : action
      expect(
        await screen.findByText(translate(locale, `admin.console.audit.verb.${alias}`)),
      ).toBeInTheDocument()
      expect(screen.queryByText(`: ${action}`)).not.toBeInTheDocument()
    }
    client.clear()
  },
)

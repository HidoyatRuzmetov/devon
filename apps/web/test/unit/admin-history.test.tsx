import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'

vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({ data: { csrfToken: 'Example-local-csrf', user: { role: 'super_admin' } } }),
}))
vi.mock('../../src/features/admin/admin-screen.js', () => ({
  AdminScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../../src/features/admin/api.js', () => ({
  fetchAdminUsers: vi.fn(),
  restoreDeletedIdentity: vi.fn(),
  fetchAuditEvents: vi.fn(),
  fetchAuditVerify: vi.fn(),
  fetchAuditExport: vi.fn(),
  anonymizeUser: vi.fn(),
  forceTwoFactorReset: vi.fn(),
  lockUser: vi.fn(),
  resetUserPassword: vi.fn(),
  unlockUser: vi.fn(),
}))
import {
  fetchAdminUsers,
  fetchAuditEvents,
  restoreDeletedIdentity,
} from '../../src/features/admin/api.js'
import AccountsScreen from '../../src/features/admin/accounts-screen.js'
import AuditScreen from '../../src/features/admin/audit-screen.js'

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  login: 'diyor.deleted-00000000',
  givenName: 'Diyor',
  familyName: 'Qodirov',
  patronymic: null,
  role: 'head' as const,
  status: 'deleted' as const,
  lastLoginAt: null,
  createdAt: '2026-10-01T00:00:00Z',
}
function show(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
  return client
}
beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
})
it('keeps a deleted head’s real name, login and role with a separate status and subtle row tint', async () => {
  vi.mocked(fetchAdminUsers).mockResolvedValue({ users: [account], nextCursor: null })
  const client = show(<AccountsScreen />)
  const name = await screen.findByText('Diyor Qodirov')
  expect(name.closest('tr')).toHaveClass('bg-destructive/5')
  await waitFor(() => expect(screen.getByText('@diyor.deleted-00000000')).toBeVisible())
  expect(screen.getByText('Head')).toBeVisible()
  expect(screen.getByText('Deleted', { selector: 'td span' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Correct historical name' })).not.toBeInTheDocument()
  client.clear()
})
it('preserves the correction draft on failure and never offers to reactivate a deleted account', async () => {
  vi.mocked(fetchAdminUsers).mockResolvedValue({
    users: [{ ...account, identityNeedsCorrection: true }],
    nextCursor: null,
  })
  vi.mocked(restoreDeletedIdentity).mockRejectedValue(new Error('Unavailable'))
  const client = show(<AccountsScreen />)
  fireEvent.click(await screen.findByRole('button', { name: 'Correct historical name' }))
  fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Diyor' } })
  fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'Qodirov' } })
  fireEvent.change(screen.getByLabelText('Source or reason for correction'), {
    target: { value: 'Verified original provisioning record' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save historical name' }))
  await waitFor(() =>
    expect(restoreDeletedIdentity).toHaveBeenCalledWith(
      account.id,
      {
        givenName: 'Diyor',
        familyName: 'Qodirov',
        reason: 'Verified original provisioning record',
      },
      'Example-local-csrf',
    ),
  )
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(screen.getByLabelText('Given name')).toHaveValue('Diyor')
  expect(screen.getByText(/account stays deleted and cannot sign in/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument()
  client.clear()
})
it('shows the named deleted actor and system initial without changing the audit event order', async () => {
  vi.mocked(fetchAuditEvents).mockResolvedValue({
    events: [
      {
        seq: 2,
        id: account.id,
        at: '2026-10-15T08:00:00Z',
        actorUserId: account.id,
        actorRole: 'head',
        actorName: 'Diyor Qodirov',
        actorStatus: 'deleted',
        actorAvatarKey: null,
        departmentId: null,
        action: 'departments.joined',
        subjectType: 'user',
        subjectId: null,
      },
      {
        seq: 1,
        id: '00000000-0000-4000-8000-000000000002',
        at: '2026-10-15T07:00:00Z',
        actorUserId: null,
        actorRole: null,
        actorName: null,
        actorStatus: null,
        actorAvatarKey: null,
        departmentId: null,
        action: 'setup.completed',
        subjectType: 'user',
        subjectId: null,
      },
    ],
    nextCursor: null,
  })
  const client = show(<AuditScreen />)
  const actor = await screen.findByText('Diyor Qodirov', { selector: 'span.font-medium' })
  expect(actor.closest('.bg-destructive\\/5')).not.toBeNull()
  await waitFor(() => expect(screen.getByText('Deleted')).toBeVisible())
  expect(screen.getByText('S')).toBeInTheDocument()
  expect(screen.queryByText('?')).not.toBeInTheDocument()
  expect(
    actor.compareDocumentPosition(screen.getByText('System', { selector: 'span.font-medium' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  client.clear()
})

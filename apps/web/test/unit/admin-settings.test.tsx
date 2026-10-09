import * as React from 'react'
import type * as UI from '@devon/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import userEvent from '@testing-library/user-event'
vi.mock('@devon/ui', async (original) => ({
  ...(await original<typeof UI>()),
  toast: vi.fn(),
}))
import { toast } from '@devon/ui'
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({ data: { csrfToken: qaExampleCredential1 } }),
}))
vi.mock('../../src/features/admin/admin-screen.js', () => ({
  AdminScreen: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../../src/features/admin/api.js', () => ({
  fetchAdminInstanceDetail: vi.fn(),
  fetchMaintenance: vi.fn(),
  fetchSentinelStatus: vi.fn(),
  fetchWipeStatus: vi.fn(),
  patchRegistration: vi.fn(),
  patchMaintenance: vi.fn(),
  rotateSentinelKey: vi.fn(),
  startWipe: vi.fn(),
  cancelWipe: vi.fn(),
  executeWipe: vi.fn(),
}))
import {
  fetchAdminInstanceDetail,
  fetchMaintenance,
  fetchSentinelStatus,
  fetchWipeStatus,
  patchRegistration,
  patchMaintenance,
  rotateSentinelKey,
  startWipe,
} from '../../src/features/admin/api.js'
import SettingsScreen from '../../src/features/admin/settings-screen.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'local-csrf'

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
})
describe('admin settings unavailable reads', () => {
  it('shows retry states and never presents unknown settings as false or offers destructive controls', async () => {
    for (const fetcher of [
      fetchAdminInstanceDetail,
      fetchMaintenance,
      fetchSentinelStatus,
      fetchWipeStatus,
    ])
      vi.mocked(fetcher).mockRejectedValue(new Error('Local unavailable read'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <SettingsScreen />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(fetchWipeStatus).toHaveBeenCalled())
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect.soft(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect.soft(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument()
    expect.soft(screen.queryByRole('button', { name: 'Generate key' })).not.toBeInTheDocument()
    expect.soft(screen.queryByRole('button', { name: 'Start wipe' })).not.toBeInTheDocument()
    expect.soft(screen.queryAllByRole('button', { name: 'Try again' }).length).toBe(4)
    for (const mutation of [patchRegistration, patchMaintenance, rotateSentinelKey, startWipe])
      expect(mutation).not.toHaveBeenCalled()
    client.clear()
  })
  it('preserves an edited locale while a background read updates another saved locale', async () => {
    vi.mocked(fetchAdminInstanceDetail).mockResolvedValue({
      isDemo: true,
      registrationOpen: true,
      userCount: 1,
    })
    vi.mocked(fetchMaintenance)
      .mockResolvedValueOnce({
        enabled: false,
        message: { 'uz-Latn': 'Saved notice', 'uz-Cyrl': '', ru: '', en: '' },
      })
      .mockResolvedValue({
        enabled: false,
        message: {
          'uz-Latn': 'Saved notice',
          'uz-Cyrl': '',
          ru: '',
          en: 'Another administrator edited this locale',
        },
      })
    vi.mocked(fetchSentinelStatus).mockResolvedValue({
      hasActiveKey: false,
      publicKeyB64: null,
      createdAt: null,
    })
    vi.mocked(fetchWipeStatus).mockResolvedValue(null)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SettingsScreen />
      </QueryClientProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Message' })
    await waitFor(() => expect(input).toHaveValue('Saved notice'))
    fireEvent.change(input, { target: { value: 'My unsaved maintenance draft' } })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin', 'maintenance'] })
    })
    await waitFor(() => expect(fetchMaintenance).toHaveBeenCalledTimes(2))
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'English' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
        'Another administrator edited this locale',
      ),
    )
    await user.click(screen.getByRole('tab', { name: 'Oʻzbekcha (lotin)' }))
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'My unsaved maintenance draft',
    )
    expect(patchMaintenance).not.toHaveBeenCalled()
    client.clear()
  })
  it('shows failed registration writes and retains the authoritative checked state', async () => {
    vi.mocked(fetchAdminInstanceDetail).mockResolvedValue({
      isDemo: true,
      registrationOpen: true,
      userCount: 1,
    })
    vi.mocked(fetchMaintenance).mockResolvedValue({ enabled: false, message: null })
    vi.mocked(fetchSentinelStatus).mockResolvedValue({
      hasActiveKey: false,
      publicKeyB64: null,
      createdAt: null,
    })
    vi.mocked(fetchWipeStatus).mockResolvedValue(null)
    vi.mocked(patchRegistration).mockRejectedValue(new Error('Local write refused'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <SettingsScreen />
      </QueryClientProvider>,
    )
    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('The change could not be saved. Try again.'),
    )
    expect(toggle).toBeChecked()
    client.clear()
  })
  it('submits all four locale message keys when enabling maintenance from an unconfigured notice', async () => {
    vi.mocked(fetchAdminInstanceDetail).mockResolvedValue({
      isDemo: true,
      registrationOpen: true,
      userCount: 1,
    })
    vi.mocked(fetchMaintenance).mockResolvedValue({ enabled: false, message: null })
    vi.mocked(fetchSentinelStatus).mockResolvedValue({
      hasActiveKey: false,
      publicKeyB64: null,
      createdAt: null,
    })
    vi.mocked(fetchWipeStatus).mockResolvedValue(null)
    vi.mocked(patchMaintenance).mockResolvedValue(undefined)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SettingsScreen />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(patchMaintenance).toHaveBeenCalled())
    expect(patchMaintenance).toHaveBeenCalledWith(
      { enabled: true, message: { 'uz-Latn': '', 'uz-Cyrl': '', ru: '', en: '' } },
      'local-csrf',
    )
    client.clear()
  })
})

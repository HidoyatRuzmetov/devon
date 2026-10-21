import * as React from 'react'
import type * as UI from '@devon/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { professionalProfileSchema } from '@devon/contracts'
import { setLocale } from '@devon/i18n'
import { ProfessionalProfileSection } from '../../src/features/accounts/professional-profile-section.js'

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../src/lib/api-client.js', () => ({ apiClient: mocks }))
vi.mock('../../src/lib/session.js', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return {
    useMeQuery: () => useQuery({ queryKey: ['me'], queryFn: async () => null, enabled: false }),
  }
})
vi.mock('@devon/ui', async (original) => ({ ...(await original<typeof UI>()), toast: vi.fn() }))
import { toast } from '@devon/ui'

const profile = (headline: string, version = 1) => ({
  profile: professionalProfileSchema.parse({ headline }),
  version,
})
const key = (owner: string) => ['accounts', 'professional-profile', owner]
const account = (owner: string) => ({ user: { id: owner }, csrfToken: `csrf-${owner}` })
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['me'], account('a'))
  mocks.get.mockImplementation(async () =>
    profile(
      client.getQueryData<{ user: { id: string } }>(['me'])!.user.id === 'a'
        ? 'A profile'
        : 'B profile',
    ),
  )
  const tree = () => (
    <QueryClientProvider client={client}>
      <ProfessionalProfileSection />
    </QueryClientProvider>
  )
  return { client, tree, view: render(tree()) }
}
beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
})

describe('professional profile ownership and form submission', () => {
  it('saves comma-separated skills and languages when Enter submits the focused input', async () => {
    mocks.put.mockImplementation(async (_path, body) => ({ ...body, version: body.version + 1 }))
    const { client } = setup()
    const user = userEvent.setup()
    await screen.findByDisplayValue('A profile')
    await user.type(screen.getByRole('textbox', { name: /^Skills/ }), 'Research, Policy')
    await user.type(screen.getByRole('textbox', { name: /^Languages/ }), 'Uzbek, English{Enter}')
    await waitFor(() => expect(mocks.put).toHaveBeenCalledOnce())
    expect(mocks.put).toHaveBeenCalledWith(
      '/api/v1/accounts/professional-profile',
      expect.objectContaining({
        profile: expect.objectContaining({
          skills: ['Research', 'Policy'],
          languages: ['Uzbek', 'English'],
        }),
        version: 1,
      }),
      expect.anything(),
      'csrf-a',
    )
    client.clear()
  })

  it('does not repopulate another account cache or notify it when an earlier save returns late', async () => {
    let finish!: (value: ReturnType<typeof profile>) => void
    mocks.put.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { client, tree, view } = setup()
    const user = userEvent.setup()
    await screen.findByDisplayValue('A profile')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.put).toHaveBeenCalledOnce())
    act(() => {
      client.clear()
      client.setQueryData(['me'], account('b'))
    })
    view.rerender(tree())
    await screen.findByDisplayValue('B profile')
    await act(async () => finish(profile('A private history', 2)))
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('B profile')
    expect(client.getQueryData(key('b'))).toEqual(profile('B profile'))
    expect(client.getQueryData(key('a'))).toBeUndefined()
    expect(toast).not.toHaveBeenCalled()
    client.clear()
  })

  it('does not replace a newer saved profile with an older mutation receipt', async () => {
    let finish!: (value: ReturnType<typeof profile>) => void
    mocks.put.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { client } = setup()
    const user = userEvent.setup()
    await screen.findByDisplayValue('A profile')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.put).toHaveBeenCalledOnce())
    act(() => {
      client.setQueryData(key('a'), profile('Newer edit', 3))
    })
    await screen.findByDisplayValue('Newer edit')
    await act(async () => finish(profile('Older receipt', 2)))
    expect(client.getQueryData(key('a'))).toEqual(profile('Newer edit', 3))
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('Newer edit')
    client.clear()
  })
})

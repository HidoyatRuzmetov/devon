import type * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { getLocale, setLocale } from '@devon/i18n'
import type { Me } from '../../src/lib/api-schemas.js'
import type * as API from '../../src/lib/api-client.js'
vi.mock('../../src/lib/api-client.js', async (original) => ({
  ...(await original<typeof API>()),
  patchMe: vi.fn(),
}))
import { patchMe } from '../../src/lib/api-client.js'
import { useLocaleMutation } from '../../src/lib/session.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'fixture-csrf'

function me(id = 'current-owner'): Me {
  return {
    user: {
      id,
      login: 'fixture',
      givenName: 'Fixture',
      familyName: 'Owner',
      patronymic: null,
      title: 'Original title',
      avatarKey: null,
      locale: 'en',
      timezone: 'Asia/Tashkent',
      role: 'member',
      mustChangePassword: false,
    },
    activeDepartmentId: 'original-department',
    memberships: [],
    membershipCount: 0,
    actingForUserId: null,
    csrfToken: qaExampleCredential1,
    instance: { isDemo: true, maintenance: false },
  }
}
function fixture() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  client.setQueryData(['me'], me())
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useLocaleMutation(), { wrapper }) }
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('devon_unsaved_locale')
  setLocale('en')
})

it('an earlier preference acknowledgement cannot replace newer intent or unrelated profile/context data', async () => {
  let resolveFirst!: (value: Me) => void
  let resolveSecond!: (value: Me) => void
  vi.mocked(patchMe)
    .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
  const { client, result, unmount } = fixture()
  try {
    act(() => result.current.mutate('ru'))
    await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(1))
    act(() => result.current.mutate('en'))
    await waitFor(() => expect(getLocale()).toBe('en'))
    client.setQueryData<Me>(['me'], {
      ...me(),
      activeDepartmentId: 'new-confirmed-department',
      user: { ...me().user, title: 'New profile title' },
    })
    resolveFirst({ ...me(), user: { ...me().user, locale: 'ru' } })
    await waitFor(() => expect(client.getMutationCache().getAll()[0]!.state.status).toBe('success'))
    await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(2))
    expect(client.getQueryData<Me>(['me'])).toMatchObject({
      activeDepartmentId: 'new-confirmed-department',
      user: { locale: 'en', title: 'New profile title' },
    })
    resolveSecond({ ...me(), user: { ...me().user, locale: 'en' } })
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(client.getQueryData<Me>(['me'])).toMatchObject({
      activeDepartmentId: 'new-confirmed-department',
      user: { locale: 'en', title: 'New profile title' },
    })
  } finally {
    resolveSecond?.({ ...me(), user: { ...me().user, locale: 'en' } })
    await waitFor(() => expect(client.isMutating()).toBe(0))
    unmount()
    client.clear()
  }
})

it('a queued old-owner preference never writes through a replacement account session', async () => {
  let resolve!: (value: Me) => void
  vi.mocked(patchMe).mockImplementationOnce(() => new Promise((done) => (resolve = done)))
  const { client, result, unmount } = fixture()
  act(() => result.current.mutate('ru'))
  await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(1))
  act(() => result.current.mutate('en'))
  await waitFor(() => expect(getLocale()).toBe('en'))
  client.setQueryData(['me'], me('replacement-owner'))
  resolve({ ...me(), user: { ...me().user, locale: 'ru' } })
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(patchMe).toHaveBeenCalledTimes(1)
  expect(client.getQueryData<Me>(['me'])?.user.id).toBe('replacement-owner')
  unmount()
  client.clear()
})

it('an old account preference reply cannot restore its owner after account replacement', async () => {
  let resolve!: (value: Me) => void
  vi.mocked(patchMe).mockImplementationOnce(() => new Promise((done) => (resolve = done)))
  const { client, result, unmount } = fixture()
  act(() => result.current.mutate('ru'))
  await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(1))
  client.setQueryData(['me'], me('new-owner'))
  resolve({ ...me(), user: { ...me().user, locale: 'ru' } })
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(client.getQueryData<Me>(['me'])?.user.id).toBe('new-owner')
  unmount()
  client.clear()
})

it('a refused latest preference retains its owner and last choice for visible retry', async () => {
  vi.mocked(patchMe).mockRejectedValueOnce(new Error('Synthetic service refusal'))
  const { client, result, unmount } = fixture()
  act(() => result.current.mutate('ru'))
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(client.getQueryData(['locale-preference-recovery'])).toMatchObject({
    locale: 'ru',
    ownerUserId: 'current-owner',
    status: 'failed',
  })
  expect(getLocale()).toBe('ru')
  expect(client.getQueryData<Me>(['me'])?.user.locale).toBe('en')
  expect(JSON.parse(localStorage.getItem('devon_unsaved_locale')!)).toEqual({
    locale: 'ru',
    ownerUserId: 'current-owner',
  })
  vi.mocked(patchMe).mockResolvedValueOnce({ ...me(), user: { ...me().user, locale: 'ru' } })
  act(() => result.current.mutate('ru'))
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(patchMe).toHaveBeenCalledTimes(2)
  expect(client.getQueryData(['locale-preference-recovery'])).toBeNull()
  expect(localStorage.getItem('devon_unsaved_locale')).toBeNull()
  unmount()
  client.clear()
})

it('a superseded refusal cannot replace the latest choice or its recovery receipt', async () => {
  let rejectFirst!: (error: Error) => void
  let resolveSecond!: (value: Me) => void
  vi.mocked(patchMe)
    .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
    .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)))
  const { client, result, unmount } = fixture()
  act(() => result.current.mutate('ru'))
  await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(1))
  act(() => result.current.mutate('en'))
  rejectFirst(new Error('Old preference refusal'))
  await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(2))
  expect(client.getQueryData(['locale-preference-recovery'])).toMatchObject({
    locale: 'en',
    status: 'pending',
    showNotice: false,
  })
  expect(getLocale()).toBe('en')
  resolveSecond(me())
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(client.getQueryData(['locale-preference-recovery'])).toBeNull()
  unmount()
  client.clear()
})

it('a failed old-owner command cannot install recovery in a replacement session', async () => {
  let reject!: (error: Error) => void
  vi.mocked(patchMe).mockImplementationOnce(() => new Promise((_resolve, fail) => (reject = fail)))
  const { client, result, unmount } = fixture()
  act(() => result.current.mutate('ru'))
  await waitFor(() => expect(patchMe).toHaveBeenCalledTimes(1))
  client.setQueryData(['me'], me('new-owner'))
  reject(new Error('Old owner refusal'))
  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(client.getQueryData(['locale-preference-recovery'])).toMatchObject({ status: 'pending' })
  expect(client.getQueryData<Me>(['me'])?.user.id).toBe('new-owner')
  unmount()
  client.clear()
})

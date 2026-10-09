import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { refreshViewAsContext } from '../../src/features/admin/view-as-cache.js'

it('removes private reads and rejects a late old-scope result before refreshing the signed context', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], { activeDepartmentId: null })
  client.setQueryData(['instance'], { registrationOpen: true })
  client.setQueryData(['admin', 'accounts'], { users: [{ id: 'old-admin-target' }] })
  client.setQueryData(['work', 'cards', 'previous-department'], [{ id: 'old-private-card' }])
  let resolveOld!: (value: string[]) => void
  let didAbort = false
  const pending = client
    .fetchQuery({
      queryKey: ['ai', 'usage', 'previous-department'],
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', () => {
          didAbort = true
        })
        return new Promise<string[]>((resolve) => {
          resolveOld = resolve
        })
      },
    })
    .catch(() => undefined)
  await refreshViewAsContext(client, async () => {
    expect(didAbort).toBe(true)
    expect(client.getQueryData(['admin', 'accounts'])).toBeUndefined()
    expect(client.getQueryData(['work', 'cards', 'previous-department'])).toBeUndefined()
    client.setQueryData(['me'], { activeDepartmentId: 'new-signed-department' })
  })
  resolveOld(['late-previous-scope-result'])
  await pending
  expect(client.getQueryData(['ai', 'usage', 'previous-department'])).toBeUndefined()
  expect(client.getQueryData(['me'])).toEqual({ activeDepartmentId: 'new-signed-department' })
  expect(client.getQueryData(['instance'])).toEqual({ registrationOpen: true })
  client.clear()
})

it('a late acknowledgement from another administrator cannot clear or rewrite the replacement session', async () => {
  const client = new QueryClient()
  client.setQueryData(['me'], {
    user: { id: 'replacement-admin', role: 'super_admin' },
    activeDepartmentId: null,
  })
  client.setQueryData(['personal', 'notes'], ['replacement private note'])
  let refreshed = false
  await refreshViewAsContext(
    client,
    async () => {
      refreshed = true
    },
    'old-administrators-lens',
    'old-admin',
  )
  expect(client.getQueryData(['me'])).toMatchObject({
    activeDepartmentId: null,
    user: { id: 'replacement-admin' },
  })
  expect(client.getQueryData(['personal', 'notes'])).toEqual(['replacement private note'])
  expect(refreshed).toBe(false)
  client.clear()
})

it('replacement during old-read cancellation cannot clear the new session private cache', async () => {
  const client = new QueryClient()
  client.setQueryData(['me'], {
    user: { id: 'old-admin', role: 'super_admin' },
    activeDepartmentId: null,
  })
  let finish!: () => void
  vi.spyOn(client, 'cancelQueries').mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  )
  const pending = refreshViewAsContext(client, async () => undefined, 'old-lens', 'old-admin')
  client.setQueryData(['me'], {
    user: { id: 'new-admin', role: 'super_admin' },
    activeDepartmentId: null,
  })
  client.setQueryData(['personal', 'notes'], ['new-session note'])
  finish()
  expect(await pending).toBe(false)
  expect(client.getQueryData(['personal', 'notes'])).toEqual(['new-session note'])
  expect(client.getQueryData(['me'])).toMatchObject({
    user: { id: 'new-admin' },
    activeDepartmentId: null,
  })
  client.clear()
})

it('a failed refresh after an acknowledged context change cannot hide the reachable exit', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['me'], {
    user: { role: 'super_admin' },
    activeDepartmentId: null,
    memberships: [],
    membershipCount: 0,
  })
  await refreshViewAsContext(client, async () => ({ isError: true }), 'confirmed-department')
  expect(client.getQueryData(['me'])).toMatchObject({ activeDepartmentId: 'confirmed-department' })
  await refreshViewAsContext(client, async () => ({ isError: true }), null)
  expect(client.getQueryData(['me'])).toMatchObject({
    activeDepartmentId: null,
    memberships: [],
    membershipCount: 0,
  })
  client.clear()
})

it('a same-actor department lens transition retains the owner language recovery receipt', async () => {
  const client = new QueryClient()
  client.setQueryData(['me'], {
    user: { id: 'admin-owner', role: 'super_admin' },
    activeDepartmentId: null,
  })
  const recovery = { ownerUserId: 'admin-owner', locale: 'ru', status: 'failed', showNotice: true }
  client.setQueryData(['locale-preference-recovery'], recovery)
  client.setQueryData(['work', 'cards'], ['old department'])
  await refreshViewAsContext(client, async () => undefined, 'signed-department', 'admin-owner')
  expect(client.getQueryData(['locale-preference-recovery'])).toEqual(recovery)
  expect(client.getQueryData(['work', 'cards'])).toBeUndefined()
  client.clear()
})

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { clearSessionCache } from '../../src/lib/session.js'
import { ACTIVE_DEPARTMENT_STORAGE_KEY } from '../../src/lib/constants.js'

describe('sign-out data boundary', () => {
  it('removes all previous-account data and stops an old request from restoring it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['personal', 'notes'], ['private note'])
    client.setQueryData(['accounts', 'profile'], { email: 'private@example.test' })
    client.setQueryData(['work', 'board'], { title: 'Previous department' })
    client.setQueryData(['admin', 'audit'], ['confidential'])
    localStorage.setItem(ACTIVE_DEPARTMENT_STORAGE_KEY, 'old-department')
    let resolve!: (value: string) => void
    const pending = client
      .fetchQuery({
        queryKey: ['personal', 'pending'],
        queryFn: () =>
          new Promise<string>((r) => {
            resolve = r
          }),
      })
      .catch(() => undefined)
    await clearSessionCache(client)
    resolve('late private response')
    await pending
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([['me']])
    expect(client.getQueryData(['me'])).toBeNull()
    expect(client.getMutationCache().getAll()).toHaveLength(0)
    expect(localStorage.getItem(ACTIVE_DEPARTMENT_STORAGE_KEY)).toBeNull()
  })
})

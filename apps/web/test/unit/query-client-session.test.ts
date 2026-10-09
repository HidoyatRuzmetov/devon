import { QueryObserver, type QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/lib/api-client.js'
import { createQueryClient } from '../../src/lib/query-client.js'

const expired = () => new ApiError(401, 'unauthenticated', null)
const owner = (id: string) => ({ user: { id } })
const clients: QueryClient[] = []
const unsubscribers: (() => void)[] = []
function fixture(readSession = vi.fn().mockResolvedValue(null)) {
  const client = createQueryClient()
  clients.push(client)
  client.setQueryData(['me'], owner('original'))
  const observer = new QueryObserver(client, { queryKey: ['me'], queryFn: readSession })
  unsubscribers.push(observer.subscribe(() => {}))
  return { client, readSession }
}
async function refusedRead(client: QueryClient, error: unknown = expired()) {
  await client
    .fetchQuery({ queryKey: ['work', 'board'], queryFn: () => Promise.reject(error) })
    .catch(() => undefined)
}
async function refusedMutation(client: QueryClient, error: unknown = expired()) {
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(error) })
    .execute(undefined)
    .catch(() => undefined)
}
afterEach(() => {
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe())
  clients.splice(0).forEach((client) => client.clear())
})

describe('feature 401 session recovery', () => {
  it('revalidates the active authoritative session after a query refusal', async () => {
    const { client, readSession } = fixture()
    await refusedRead(client)
    await vi.waitFor(() => expect(client.getQueryData(['me'])).toBeNull())
    expect(readSession).toHaveBeenCalledTimes(1)
  })

  it('revalidates after a mutation refusal without retrying the write', async () => {
    const { client, readSession } = fixture()
    const write = vi.fn().mockRejectedValue(expired())
    await client
      .getMutationCache()
      .build(client, { mutationFn: write })
      .execute(undefined)
      .catch(() => undefined)
    await vi.waitFor(() => expect(client.getQueryData(['me'])).toBeNull())
    expect(readSession).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('shares one pending session read across concurrent read and write refusals', async () => {
    let resolve!: (value: null) => void
    const readSession = vi.fn(
      () =>
        new Promise<null>((done) => {
          resolve = done
        }),
    )
    const { client } = fixture(readSession)
    await Promise.all([refusedRead(client), refusedMutation(client)])
    expect(readSession).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['me'])).toEqual(owner('original'))
    resolve(null)
    await vi.waitFor(() => expect(client.getQueryData(['me'])).toBeNull())
  })

  it('does not sign out a replacement session when an old feature request returns 401 late', async () => {
    const replacement = owner('replacement')
    const { client, readSession } = fixture(vi.fn().mockResolvedValue(replacement))
    let reject!: (reason: unknown) => void
    const oldRead = client
      .fetchQuery({
        queryKey: ['work', 'old-request'],
        queryFn: () =>
          new Promise((_resolve, fail) => {
            reject = fail
          }),
      })
      .catch(() => undefined)
    client.setQueryData(['me'], replacement)
    reject(expired())
    await oldRead
    await vi.waitFor(() => expect(readSession).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(client.getQueryState(['me'])?.fetchStatus).toBe('idle'))
    expect(client.getQueryData(['me'])).toEqual(replacement)
  })

  it('preserves a later login session response when it replaces a pending expiry check', async () => {
    let resolveOld!: (value: null) => void
    const replacement = owner('replacement')
    const readSession = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<null>((done) => {
            resolveOld = done
          }),
      )
      .mockResolvedValue(replacement)
    const { client } = fixture(readSession)
    await refusedRead(client)
    // LoginRoute uses this same invalidation after the new session cookie has been established.
    await client.invalidateQueries({ queryKey: ['me'] })
    resolveOld(null)
    await Promise.resolve()
    expect(client.getQueryData(['me'])).toEqual(replacement)
    expect(readSession).toHaveBeenCalledTimes(2)
  })

  it.each([403, 404, 410, 422])('keeps the session on a feature %s refusal', async (status) => {
    const { client, readSession } = fixture()
    const error = new ApiError(status, 'refused', null)
    await Promise.all([refusedRead(client, error), refusedMutation(client, error)])
    expect(readSession).not.toHaveBeenCalled()
    expect(client.getQueryData(['me'])).toEqual(owner('original'))
  })

  it('does not recheck an anonymous session or recurse on the session query itself', async () => {
    const { client, readSession } = fixture()
    client.setQueryData(['me'], null)
    await Promise.all([refusedRead(client), refusedMutation(client)])
    expect(readSession).not.toHaveBeenCalled()
    client.setQueryData(['me'], owner('original'))
    await client
      .fetchQuery({ queryKey: ['me'], staleTime: 0, queryFn: () => Promise.reject(expired()) })
      .catch(() => undefined)
    expect(readSession).not.toHaveBeenCalled()
    expect(client.getQueryData(['me'])).toEqual(owner('original'))
  })
})

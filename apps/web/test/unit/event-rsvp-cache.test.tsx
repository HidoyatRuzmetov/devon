import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventDto } from '../../src/features/events/schemas.js'
import { useRsvpMutation } from '../../src/features/events/hooks.js'
import { submitRsvp } from '../../src/features/events/api.js'
import type * as EventApi from '../../src/features/events/api.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'local-csrf'

vi.mock('../../src/features/events/api.js', async (original) => ({
  ...(await original<typeof EventApi>()),
  submitRsvp: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const event: EventDto = {
  id: 'event-a',
  title: 'Original title',
  description: null,
  category: 'other',
  illustrationKey: 'other',
  startsAt: '2026-11-12T04:00:00Z',
  endsAt: '2026-11-12T05:00:00Z',
  timezone: 'Asia/Tashkent',
  place: null,
  placeUrl: null,
  capacity: 1,
  waitlistEnabled: true,
  rsvpDeadline: null,
  costNote: null,
  reminderOffsetsMinutes: [],
  organizer: { id: 'head', givenName: 'Local', familyName: 'Head' },
  status: 'open',
  updatedSummary: null,
  cancelledAt: null,
  cancelledReason: null,
  goingCount: 0,
  maybeCount: 0,
  waitlistCount: 0,
  myRsvp: null,
  canManage: false,
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
  version: 1,
}
const detailKey = ['events', 'detail', event.id]
const listKey = ['events', 'list', undefined, undefined]
const clients: QueryClient[] = []

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(detailKey, event)
  client.setQueryData(listKey, { items: [event, { ...event, id: 'unrelated-event' }] })
  client.setQueryData(['me'], { csrfToken: qaExampleCredential1 })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useRsvpMutation(event.id), { wrapper })
  return { client, ...hook }
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.restoreAllMocks()
  vi.mocked(submitRsvp).mockReset()
})

describe('event RSVP cache consistency', () => {
  it('cancels an older detail read and immediately applies the actual waitlist/count response before refresh completes', async () => {
    const { client, result } = show()
    const read = deferred<EventDto>()
    const oldRequest = client
      .fetchQuery({ queryKey: detailKey, queryFn: () => read.promise })
      .catch(() => undefined)
    const write = deferred<EventDto>()
    vi.mocked(submitRsvp).mockReturnValue(write.promise)
    const refresh = deferred<void>()
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(refresh.promise)
    act(() => result.current.mutate({ status: 'yes', guests: 0 }))
    await waitFor(() => expect(submitRsvp).toHaveBeenCalledOnce())
    expect(client.getQueryData<EventDto>(detailKey)?.myRsvp?.status).toBe('yes')
    await act(async () => {
      read.resolve(event)
      await oldRequest
    })
    expect(client.getQueryData<EventDto>(detailKey)?.myRsvp?.status).toBe('yes')
    const actual = {
      ...event,
      status: 'full' as const,
      goingCount: 1,
      waitlistCount: 1,
      myRsvp: { status: 'waitlist' as const, guests: 0, note: null },
    }
    await act(async () => write.resolve(actual))
    await waitFor(() =>
      expect(client.getQueryData<EventDto>(detailKey)?.myRsvp?.status).toBe('waitlist'),
    )
    expect(client.getQueryData<{ items: EventDto[] }>(listKey)?.items[0]).toEqual(actual)
    expect(client.getQueryData<{ items: EventDto[] }>(listKey)?.items[1]?.id).toBe(
      'unrelated-event',
    )
    expect(result.current.isPending).toBe(true)
    await act(async () => refresh.resolve())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('rolls back only the failed answer, retaining independent refreshed event fields', async () => {
    const { client, result } = show()
    const write = deferred<EventDto>()
    vi.mocked(submitRsvp).mockReturnValue(write.promise)
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    act(() => result.current.mutate({ status: 'yes', guests: 0 }))
    await waitFor(() => expect(submitRsvp).toHaveBeenCalledOnce())
    const independent = {
      ...client.getQueryData<EventDto>(detailKey)!,
      title: 'Updated by organizer',
      version: 2,
    }
    client.setQueryData(detailKey, independent)
    client.setQueryData(listKey, {
      items: [independent, { ...event, id: 'unrelated-event', goingCount: 3 }],
    })
    await act(async () => write.reject(new Error('Injected local refusal')))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData<EventDto>(detailKey)).toMatchObject({
      title: 'Updated by organizer',
      version: 2,
      myRsvp: null,
    })
    expect(client.getQueryData<{ items: EventDto[] }>(listKey)?.items[0]).toMatchObject({
      title: 'Updated by organizer',
      myRsvp: null,
    })
    expect(client.getQueryData<{ items: EventDto[] }>(listKey)?.items[1]?.goingCount).toBe(3)
  })

  it('serializes competing answers and refreshes only after the final queued write', async () => {
    const { client, result } = show()
    const first = deferred<EventDto>()
    const second = deferred<EventDto>()
    vi.mocked(submitRsvp).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const refresh = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    act(() => {
      result.current.mutate({ status: 'yes', guests: 0 })
      result.current.mutate({ status: 'no', guests: 0 })
    })
    await waitFor(() => expect(submitRsvp).toHaveBeenCalledOnce())
    await act(async () =>
      first.resolve({ ...event, myRsvp: { status: 'yes', guests: 0, note: null } }),
    )
    await waitFor(() => expect(submitRsvp).toHaveBeenCalledTimes(2))
    expect(refresh).not.toHaveBeenCalled()
    await act(async () =>
      second.resolve({ ...event, myRsvp: { status: 'no', guests: 0, note: null } }),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData<EventDto>(detailKey)?.myRsvp?.status).toBe('no')
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['events', 'rsvps', event.id] })
  })
})

import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeInvalidator } from '../../src/lib/realtime/hooks.js'

describe('live refresh during optimistic writes', () => {
  it('refreshes member Home assignments and counts from one card event without polling', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    const keys = [
      ['work', 'member-home', 'cards', 'department-a', 'member-a', null],
      ['work', 'member-home', 'counts', 'department-a', 'member-a', null],
    ]
    let status = 'active'
    const read = vi.fn(async () => status)
    await Promise.all(keys.map((queryKey) => client.fetchQuery({ queryKey, queryFn: read })))
    const stops = keys.map((queryKey) =>
      new QueryObserver(client, { queryKey, queryFn: read }).subscribe(() => {}),
    )
    const bridge = createRealtimeInvalidator(client)
    try {
      status = 'done'
      bridge.receive('work.card.updated')
      await vi.waitFor(() => {
        for (const key of keys) expect(client.getQueryData(key)).toBe('done')
      })
      expect(read).toHaveBeenCalledTimes(4)
    } finally {
      bridge.dispose()
      for (const stop of stops) stop()
      client.clear()
    }
  })
  it.each(['attachments.approval.reviewed', 'inbox.notification.created'])(
    'refreshes an open approval view on %s without a per-screen timer',
    async (type) => {
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
      const keys = [
        ['admin', 'file-approvals'],
        ['work', 'attachments', 'card-a', 'approvals'],
        ['pages', 'attachments', 'page-a', 'approvals'],
      ]
      let status = 'pending'
      const read = vi.fn(async () => status)
      await Promise.all(keys.map((key) => client.fetchQuery({ queryKey: key, queryFn: read })))
      const stops = keys.map((key) =>
        new QueryObserver(client, { queryKey: key, queryFn: read }).subscribe(() => {}),
      )
      const bridge = createRealtimeInvalidator(client)
      try {
        status = 'approved'
        bridge.receive(type)
        await vi.waitFor(() => {
          for (const key of keys) expect(client.getQueryData(key)).toBe('approved')
        })
        expect(read).toHaveBeenCalledTimes(6)
      } finally {
        bridge.dispose()
        for (const stop of stops) stop()
        client.clear()
      }
    },
  )
  it.each(['accounts.user.avatar_updated', 'accounts.profile.updated'])(
    'refreshes photo/name summaries when %s arrives',
    async (type) => {
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
      const keys = [
        ['me'],
        ['work', 'board'],
        ['structure', 'members'],
        ['events', 'rsvps', 'event-a'],
        ['departments', 'members'],
        ['people', 'table'],
        ['admin', 'audit'],
      ]
      for (const key of keys) client.setQueryData(key, { avatarKey: 'old' })
      client.setQueryData(['personal', 'notes'], 'private unchanged')
      const bridge = createRealtimeInvalidator(client)
      try {
        bridge.receive(type)
        for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
        expect(client.getQueryState(['personal', 'notes'])?.isInvalidated).toBe(false)
      } finally {
        bridge.dispose()
        client.clear()
      }
    },
  )
  it('updates a still-open personal reminder from pending to sent when its Inbox delivery arrives', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    const key = ['work', 'reminders', 'card-a']
    let sentAt: string | null = null
    const read = vi.fn(async () => [{ id: 'reminder-a', sentAt }])
    await client.fetchQuery({ queryKey: key, queryFn: read })
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: read,
      staleTime: Infinity,
    })
    const stop = observer.subscribe(() => {})
    const bridge = createRealtimeInvalidator(client)
    try {
      expect(client.getQueryData(key)).toEqual([{ id: 'reminder-a', sentAt: null }])
      sentAt = '2026-10-12T05:20:00.000Z'
      bridge.receive('inbox.notification.created')
      await vi.waitFor(() =>
        expect(client.getQueryData(key)).toEqual([{ id: 'reminder-a', sentAt }]),
      )
      expect(read).toHaveBeenCalledTimes(2)
    } finally {
      bridge.dispose()
      stop()
      client.clear()
    }
  })
  it('catches up unprotected reads immediately after reconnect and protected reads after the failed write settles', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    })
    const eventKey = ['events', 'detail', 'event-a']
    const analyticsKey = ['analytics', 'summary']
    let serverValue = 'before disconnect'
    const readEvent = vi.fn(async () => serverValue)
    const readAnalytics = vi.fn(async () => serverValue)
    await client.fetchQuery({ queryKey: eventKey, queryFn: readEvent })
    await client.fetchQuery({ queryKey: analyticsKey, queryFn: readAnalytics })
    const eventObserver = new QueryObserver(client, {
      queryKey: eventKey,
      queryFn: readEvent,
      staleTime: Infinity,
    })
    const analyticsObserver = new QueryObserver(client, {
      queryKey: analyticsKey,
      queryFn: readAnalytics,
      staleTime: Infinity,
    })
    const stopEvent = eventObserver.subscribe(() => {})
    const stopAnalytics = analyticsObserver.subscribe(() => {})
    const bridge = createRealtimeInvalidator(client)
    let reject!: (error: Error) => void
    const write = client
      .getMutationCache()
      .build(client, {
        mutationKey: ['events', 'rsvp', 'event-a'],
        mutationFn: () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail
          }),
      })
      .execute(undefined)
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
    client.setQueryData(eventKey, 'unfinished local choice')
    serverValue = 'changed during disconnect'
    bridge.catchUp()
    await vi.waitFor(() => expect(client.getQueryData(analyticsKey)).toBe(serverValue))
    expect(client.getQueryData(eventKey)).toBe('unfinished local choice')
    expect(readEvent).toHaveBeenCalledTimes(1)
    reject(new Error('controlled write failure'))
    await write
    await vi.waitFor(() => expect(client.getQueryData(eventKey)).toBe(serverValue))
    expect(readEvent).toHaveBeenCalledTimes(2)
    bridge.dispose()
    stopEvent()
    stopAnalytics()
    client.clear()
  })
  it.each([
    {
      event: 'departments.join_request.decided',
      query: ['me'],
      mutation: ['departments', 'pendingAction', 'department-a'],
    },
    {
      event: 'events.rsvp.updated',
      query: ['events', 'detail', 'event-a'],
      mutation: ['events', 'rsvp', 'event-a'],
    },
    {
      event: 'work.card.updated',
      query: ['work', 'board'],
      mutation: ['work', 'card-write', 'card-a'],
    },
    {
      event: 'projects.updated',
      query: ['projects', 'detail', 'project-a'],
      mutation: ['work', 'checklist', 'card-a'],
    },
    {
      event: 'pages.page.updated',
      query: ['pages', 'detail', 'page-a'],
      mutation: ['pages', 'write', 'page-a'],
    },
    {
      event: 'pages.onboarding_template.updated',
      query: ['pages', 'onboardingTemplates'],
      mutation: ['pages', 'templates-write'],
    },
    {
      event: 'departments.membership.changed',
      query: ['departments', 'members', 'department-a'],
      mutation: ['departments', 'pendingAction', 'department-a'],
    },
    {
      event: 'departments.membership.changed',
      query: ['me'],
      mutation: ['departments', 'pendingAction', 'department-a'],
    },
    {
      event: 'departments.membership.changed',
      query: ['work', 'board'],
      mutation: ['work', 'card-write', 'card-a'],
    },
  ])(
    'preserves pending input then applies the latest server read: $event',
    async ({ event, query, mutation }) => {
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      })
      let serverValue = 'original'
      const read = vi.fn(async () => serverValue)
      await client.fetchQuery({ queryKey: query, queryFn: read })
      const observer = new QueryObserver(client, {
        queryKey: query,
        queryFn: read,
        staleTime: Infinity,
      })
      const stopObserver = observer.subscribe(() => {})
      const bridge = createRealtimeInvalidator(client)
      let complete!: () => void
      const pending = client
        .getMutationCache()
        .build(client, {
          mutationKey: mutation,
          mutationFn: () =>
            new Promise<void>((resolve) => {
              complete = resolve
            }),
        })
        .execute(undefined)
      await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
      client.setQueryData(query, 'pending local input')
      serverValue = 'another colleague changed it'
      bridge.receive(event)
      bridge.receive(event)
      expect(read).toHaveBeenCalledTimes(1)
      expect(client.getQueryData(query)).toBe('pending local input')
      complete()
      await pending
      await vi.waitFor(() =>
        expect(client.getQueryData(query)).toBe('another colleague changed it'),
      )
      expect(read).toHaveBeenCalledTimes(2)
      bridge.dispose()
      stopObserver()
      client.clear()
    },
  )

  it('waits for the final concurrent RSVP, including failure, and releases its subscription', async () => {
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries')
    const bridge = createRealtimeInvalidator(client)
    let first!: () => void
    let second!: (error: Error) => void
    const one = client
      .getMutationCache()
      .build(client, {
        mutationKey: ['events', 'rsvp', 'a'],
        mutationFn: () =>
          new Promise<void>((resolve) => {
            first = resolve
          }),
      })
      .execute(undefined)
    const two = client
      .getMutationCache()
      .build(client, {
        mutationKey: ['events', 'rsvp', 'b'],
        mutationFn: () =>
          new Promise<void>((_resolve, reject) => {
            second = reject
          }),
      })
      .execute(undefined)
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(second).toBeTypeOf('function'))
    bridge.receive('events.rsvp.updated')
    first()
    await one
    expect(refresh).not.toHaveBeenCalled()
    second(new Error('controlled local failure'))
    await two
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ queryKey: ['events'] })
    bridge.dispose()
    client.clear()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes unrelated structure updates immediately during a pending RSVP write', async () => {
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries')
    const bridge = createRealtimeInvalidator(client)
    let finish!: () => void
    const pending = client
      .getMutationCache()
      .build(client, {
        mutationKey: ['events', 'rsvp', 'event-a'],
        mutationFn: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      })
      .execute(undefined)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    bridge.receive('structure.employee.updated')
    bridge.receive('unknown.event')
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ queryKey: ['structure'] })
    finish()
    await pending
    expect(refresh).toHaveBeenCalledTimes(1)
    bridge.dispose()
    client.clear()
  })

  it('does not flush a deferred refresh after its session bridge has been disposed', async () => {
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries')
    const bridge = createRealtimeInvalidator(client)
    let finish!: () => void
    const pending = client
      .getMutationCache()
      .build(client, {
        mutationKey: ['events', 'rsvp', 'event-a'],
        mutationFn: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      })
      .execute(undefined)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    bridge.receive('events.rsvp.changed')
    bridge.dispose()
    finish()
    await pending
    expect(refresh).not.toHaveBeenCalled()
    client.clear()
  })
})

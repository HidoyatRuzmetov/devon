import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import { clearSubscriptions, dispatch } from '@devon/db'
import { broadcast, publish } from '../../src/modules/realtime/publisher.js'
import {
  __resetRealtimeSubscriptionsForTests,
  registerRealtimeEventSubscriptions,
} from '../../src/modules/realtime/events.js'

vi.mock('../../src/modules/realtime/publisher.js', () => ({ broadcast: vi.fn(), publish: vi.fn() }))

const departmentId = '7ab28e71-8f8f-4b11-86a7-445921a06a96'
const userId = '17a3e42d-8b1e-4a64-a13b-706279cd8a36'
const emit = (type: string) =>
  dispatch({
    id: 'event',
    type,
    departmentId,
    payload: {
      conversationId: 'private-conversation',
      userId,
      messageId: 'private-message',
      content: 'Private question',
    },
    createdAt: new Date(),
    attempts: 0,
  })

describe('private AI events stay outside shared realtime channels', () => {
  beforeEach(() => {
    clearSubscriptions()
    __resetRealtimeSubscriptionsForTests()
    vi.clearAllMocks()
    registerRealtimeEventSubscriptions(
      { debug: vi.fn() } as unknown as FastifyBaseLogger,
      'http://localhost:3000',
    )
  })
  afterEach(() => {
    clearSubscriptions()
    __resetRealtimeSubscriptionsForTests()
  })

  it.each([
    'created',
    'requested',
    'started',
    'answered',
    'failed',
    'cancelled',
    'interrupted',
    'metered',
  ])('does not publish conversation %s metadata or content', async (action) => {
    expect(await emit(`ai.conversation.${action}`)).toEqual({ ok: true })
    expect(broadcast).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
  it('still broadcasts ordinary department updates through the same subscriber', async () => {
    expect(await emit('work.card.updated')).toEqual({ ok: true })
    expect(broadcast).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledWith(
      [`dept:${departmentId}`],
      expect.objectContaining({ type: 'work.card.updated' }),
    )
  })
})

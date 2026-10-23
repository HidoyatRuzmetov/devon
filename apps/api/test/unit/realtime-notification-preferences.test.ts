import { afterEach, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import { clearSubscriptions, dispatch } from '@devon/db'
import { broadcast, publish } from '../../src/modules/realtime/publisher.js'
import { sendPushToUser } from '../../src/modules/realtime/push.js'
import {
  __resetRealtimeSubscriptionsForTests,
  registerRealtimeEventSubscriptions,
} from '../../src/modules/realtime/events.js'

vi.mock('../../src/modules/realtime/publisher.js', () => ({
  broadcast: vi.fn(),
  publish: vi.fn(),
}))
vi.mock('../../src/modules/realtime/push.js', () => ({
  sendPushToUser: vi.fn(),
}))
afterEach(() => {
  clearSubscriptions()
  __resetRealtimeSubscriptionsForTests()
})

it('does not publish a live toast, bell update or browser push for a muted app channel', async () => {
  clearSubscriptions()
  __resetRealtimeSubscriptionsForTests()
  const log = { debug: vi.fn() } as unknown as FastifyBaseLogger
  registerRealtimeEventSubscriptions(log, 'http://localhost:3000')
  expect(
    await dispatch({
      id: 'muted',
      type: 'notifications.notification.created',
      departmentId: null,
      payload: {
        userId: 'owner',
        notificationId: 'notice',
        reason: 'due',
        inappVisible: false,
      },
      createdAt: new Date(),
      attempts: 0,
    }),
  ).toEqual({ ok: true })
  expect(publish).not.toHaveBeenCalled()
  expect(broadcast).not.toHaveBeenCalled()
  expect(sendPushToUser).not.toHaveBeenCalled()
  expect(log.debug).not.toHaveBeenCalled()
})

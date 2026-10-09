import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventRecord } from '@devon/db'

vi.mock('../../../src/modules/events/telegram-delivery-repo.js', () => ({
  queueGroupDeliveries: vi.fn().mockResolvedValue(2),
  claimGroupDelivery: vi.fn(),
  groupDeliveryPointer: vi.fn(),
  finishGroupDelivery: vi.fn(),
}))
vi.mock('../../../src/modules/telegram/transport.js', () => ({
  isTelegramConfigured: vi.fn().mockReturnValue(true),
  publicUrl: () => 'https://portal.example.test',
  sendPlainMessage: vi.fn(() => {
    throw new Error('External Telegram is excluded')
  }),
}))
vi.mock('../../../src/modules/notifications/repo.js', () => ({
  isMaintenanceActive: vi.fn().mockResolvedValue(false),
}))
import * as repo from '../../../src/modules/events/telegram-delivery-repo.js'
import { isTelegramConfigured } from '../../../src/modules/telegram/transport.js'
import { isMaintenanceActive } from '../../../src/modules/notifications/repo.js'
import {
  processEventGroupDeliveries,
  queueEventGroupNotifications,
} from '../../../src/modules/events/telegram-delivery.js'

const ID = '550e8400-e29b-41d4-a716-446655440000'
function event(type = 'events.event.created'): OutboxEventRecord {
  return {
    id: ID,
    type,
    departmentId: ID,
    payload: { eventId: ID },
    createdAt: new Date(),
    attempts: 0,
  }
}
const delivery = {
  id: ID,
  department_id: ID,
  event_id: ID,
  poll_id: null,
  group_id: ID,
  event_type: 'events.event.created',
  group_kind: 'events' as const,
  lease_token: ID,
  attempts: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isTelegramConfigured).mockReturnValue(true)
  vi.mocked(isMaintenanceActive).mockResolvedValue(false)
  vi.mocked(repo.claimGroupDelivery).mockResolvedValue(null)
  vi.mocked(repo.groupDeliveryPointer).mockResolvedValue({
    chatId: '-1001234567890',
    locale: 'en',
    event: {
      id: ID,
      title: 'Local team meeting',
      starts_at: new Date('2026-11-12T04:00:00Z'),
      timezone: 'Asia/Tashkent',
      description: 'Do not broadcast this private note',
    },
  } as Awaited<ReturnType<typeof repo.groupDeliveryPointer>>)
})

describe('event broadcasts with Telegram transport excluded', () => {
  it('queues the committed event pointer for all connected subscribed groups without sending', async () => {
    const row = event()
    expect(await queueEventGroupNotifications(row)).toBe(2)
    expect(repo.queueGroupDeliveries).toHaveBeenCalledWith(row, ID, 'events', null)
  })
  it.each(['events.rsvp.changed', 'events.comment.created', 'work.card.created'])(
    'never broadcasts personal activity %s',
    async (type) => {
      expect(await queueEventGroupNotifications(event(type))).toBe(0)
      expect(repo.queueGroupDeliveries).not.toHaveBeenCalled()
    },
  )
  it('refuses malformed pointers and poll events missing a real poll id', async () => {
    expect(await queueEventGroupNotifications({ ...event(), payload: { eventId: 'bad' } })).toBe(0)
    expect(await queueEventGroupNotifications(event('events.poll.created'))).toBe(0)
    expect(repo.queueGroupDeliveries).not.toHaveBeenCalled()
  })
  it.each(['disabled', 'maintenance'])('does not claim or send while %s', async (mode) => {
    if (mode === 'disabled') vi.mocked(isTelegramConfigured).mockReturnValue(false)
    else vi.mocked(isMaintenanceActive).mockResolvedValue(true)
    const send = vi.fn()
    expect(await processEventGroupDeliveries(20, send)).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(repo.claimGroupDelivery).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it('sends a title/date/website pointer to a supergroup, without descriptions or personal callback data', async () => {
    vi.mocked(repo.claimGroupDelivery).mockResolvedValueOnce(delivery)
    const send = vi.fn().mockResolvedValue({ ok: true, messageId: 123 })
    expect(await processEventGroupDeliveries(20, send)).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledWith(
      '-1001234567890',
      expect.stringContaining('Local team meeting'),
    )
    const text = send.mock.calls[0]![1] as string
    expect(text).toContain('09:00')
    expect(text).toContain(`https://portal.example.test/events?event=${ID}`)
    expect(text).not.toContain('private note')
    expect(repo.finishGroupDelivery).toHaveBeenCalledWith(delivery, {
      status: 'sent',
      messageId: 123,
    })
  })
  it('marks disconnected, deleted or closed targets skipped without a send', async () => {
    vi.mocked(repo.claimGroupDelivery).mockResolvedValueOnce(delivery)
    vi.mocked(repo.groupDeliveryPointer).mockResolvedValueOnce(null)
    const send = vi.fn()
    expect(await processEventGroupDeliveries(20, send)).toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(send).not.toHaveBeenCalled()
  })
  it('retains a pause that happens after the lease instead of silently dropping delivery', async () => {
    vi.mocked(repo.claimGroupDelivery).mockResolvedValueOnce(delivery)
    vi.mocked(repo.groupDeliveryPointer).mockResolvedValueOnce({ paused: true })
    const send = vi.fn()
    await processEventGroupDeliveries(20, send)
    expect(send).not.toHaveBeenCalled()
    expect(repo.finishGroupDelivery).toHaveBeenCalledWith(delivery, {
      status: 'pending',
      error: 'delivery_paused',
    })
  })
  it('records only a fixed failure code and continues to the next group after a transport rejection', async () => {
    vi.mocked(repo.claimGroupDelivery)
      .mockResolvedValueOnce(delivery)
      .mockResolvedValueOnce({ ...delivery, id: 'second' })
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('contains secret URL'))
      .mockResolvedValueOnce({ ok: true, messageId: 456 })
    expect(await processEventGroupDeliveries(20, send)).toEqual({ sent: 1, skipped: 0, failed: 1 })
    expect(repo.finishGroupDelivery).toHaveBeenCalledWith(delivery, {
      status: 'pending',
      error: 'telegram_send_failed',
    })
    expect(repo.finishGroupDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'second' }),
      { status: 'sent', messageId: 456 },
    )
  })
  it('stops retrying a failed target at the bounded attempt limit', async () => {
    const exhausted = { ...delivery, attempts: 8 }
    vi.mocked(repo.claimGroupDelivery).mockResolvedValueOnce(exhausted)
    await processEventGroupDeliveries(
      20,
      vi.fn().mockResolvedValue({ ok: false, error: 'no access' }),
    )
    expect(repo.finishGroupDelivery).toHaveBeenCalledWith(exhausted, {
      status: 'failed',
      error: 'telegram_send_failed',
    })
  })
  it('does not send again after an eighth attempt crashed before acknowledgment', async () => {
    const exhausted = { ...delivery, attempts: 9 }
    vi.mocked(repo.claimGroupDelivery).mockResolvedValueOnce(exhausted)
    const send = vi.fn()
    expect(await processEventGroupDeliveries(20, send)).toEqual({ sent: 0, skipped: 0, failed: 1 })
    expect(send).not.toHaveBeenCalled()
    expect(repo.groupDeliveryPointer).not.toHaveBeenCalled()
    expect(repo.finishGroupDelivery).toHaveBeenCalledWith(exhausted, {
      status: 'failed',
      error: 'telegram_retry_limit',
    })
  })
  it.each([
    ['Europe/London', '04:00'],
    ['not/a/timezone', '09:00'],
  ])(
    'renders the event timezone %s without letting old malformed data crash the queue',
    async (timezone, expected) => {
      vi.mocked(repo.claimGroupDelivery).mockResolvedValueOnce(delivery)
      vi.mocked(repo.groupDeliveryPointer).mockResolvedValueOnce({
        chatId: '-1001234567890',
        locale: 'en',
        event: {
          id: ID,
          title: 'Timezone check',
          starts_at: new Date('2026-11-12T04:00:00Z'),
          timezone,
        },
      } as Awaited<ReturnType<typeof repo.groupDeliveryPointer>>)
      const send = vi.fn().mockResolvedValue({ ok: true, messageId: 123 })
      await processEventGroupDeliveries(20, send)
      expect(send.mock.calls[0]![1]).toContain(expected)
    },
  )
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import type { NotificationRow } from '../../src/modules/notifications/repo.js'

vi.mock('../../src/modules/notifications/repo.js', () => ({
  getPrefs: vi.fn(),
  getNotificationById: vi.fn().mockResolvedValue({ id: 'digest' }),
  getDepartmentQuietDefault: vi.fn(),
  getPersonalQuietHours: vi.fn().mockResolvedValue(null),
  recordDelivery: vi.fn(),
  systemAuditCtx: vi.fn(),
}))
vi.mock('../../src/modules/telegram/repo.js', () => ({
  resolveTelegramChatId: vi.fn().mockResolvedValue('fixture-chat'),
}))
vi.mock('../../src/modules/telegram/transport.js', () => ({
  sendTelegramNotification: vi.fn().mockResolvedValue({ ok: true, messageId: 1 }),
}))

import { getPrefs, recordDelivery } from '../../src/modules/notifications/repo.js'
import { sendTelegramNotification } from '../../src/modules/telegram/transport.js'
import { deliverNotification } from '../../src/modules/notifications/delivery.js'

describe('scheduled personal digest delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T05:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  const log = { error: vi.fn() } as unknown as FastifyBaseLogger

  it.each(['daily', 'weekly'] as const)(
    'sends the scheduled %s summary even though its preference is not instant',
    async (mode) => {
      vi.mocked(getPrefs).mockResolvedValue([
        { reason: 'digest', channel: 'telegram', enabled: true, digestMode: mode },
      ])
      await deliverNotification(
        log,
        {
          id: 'digest',
          reason: 'digest',
          type: `notifications.digest.${mode}`,
          departmentId: null,
        } as NotificationRow,
        'owner',
      )
      expect(sendTelegramNotification).toHaveBeenCalledOnce()
      expect(recordDelivery).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ status: 'sent', channel: 'telegram' }),
      )
    },
  )

  it.each([
    { enabled: false, digestMode: 'daily' as const, type: 'notifications.digest.daily' },
    { enabled: true, digestMode: 'off' as const, type: 'notifications.digest.daily' },
    { enabled: true, digestMode: 'weekly' as const, type: 'notifications.digest.daily' },
    { enabled: true, digestMode: 'daily' as const, type: 'manual.digest' },
  ])(
    'respects disabled/off/frequency mismatches and avoids unrelated immediate summaries: %j',
    async ({ type, ...pref }) => {
      vi.mocked(getPrefs).mockResolvedValue([{ reason: 'digest', channel: 'telegram', ...pref }])
      await deliverNotification(
        log,
        { id: 'digest', reason: 'digest', type } as NotificationRow,
        'owner',
      )
      expect(sendTelegramNotification).not.toHaveBeenCalled()
    },
  )
})

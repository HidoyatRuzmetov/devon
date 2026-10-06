import { expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import type { NotificationRow } from '../../src/modules/notifications/repo.js'

vi.mock('../../src/modules/notifications/repo.js', () => ({
  getPrefs: vi
    .fn()
    .mockResolvedValue([
      { reason: 'due', channel: 'telegram', enabled: true, digestMode: 'instant' },
    ]),
  getNotificationById: vi.fn().mockResolvedValue(null),
  getDepartmentQuietDefault: vi.fn(),
  getPersonalQuietHours: vi.fn(),
  recordDelivery: vi.fn(),
  systemAuditCtx: vi.fn(),
}))
vi.mock('../../src/modules/telegram/repo.js', () => ({
  resolveTelegramChatId: vi.fn().mockResolvedValue('fixture-chat'),
}))
vi.mock('../../src/modules/telegram/transport.js', () => ({ sendTelegramNotification: vi.fn() }))

import { getNotificationById } from '../../src/modules/notifications/repo.js'
import { sendTelegramNotification } from '../../src/modules/telegram/transport.js'
import { deliverNotification } from '../../src/modules/notifications/delivery.js'

it('does not send a retained notification after its task becomes hidden, even with instant Telegram enabled', async () => {
  const log = { error: vi.fn() } as unknown as FastifyBaseLogger
  await deliverNotification(
    log,
    { id: 'notification-fixture', reason: 'due', subjectType: 'card' } as NotificationRow,
    'owner-fixture',
  )
  expect(getNotificationById).toHaveBeenCalledWith('owner-fixture', 'notification-fixture')
  expect(sendTelegramNotification).not.toHaveBeenCalled()
  expect(log.error).not.toHaveBeenCalled()
})

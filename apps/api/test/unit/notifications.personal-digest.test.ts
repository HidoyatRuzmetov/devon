import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'

vi.mock('../../src/modules/notifications/repo.js', () => ({
  isMaintenanceActive: vi.fn().mockResolvedValue(false),
  listAllDepartmentIds: vi.fn().mockResolvedValue(['department']),
  listActiveMemberUserIds: vi.fn().mockResolvedValue(['owner']),
  getPrefs: vi.fn(),
  unreadCountsByReason: vi.fn(),
}))
vi.mock('../../src/modules/notifications/notify.js', () => ({ notifyUser: vi.fn() }))
vi.mock('../../src/modules/ai/service.js', () => ({ narrateDepartmentWeek: vi.fn() }))
import {
  getPrefs,
  listAllDepartmentIds,
  unreadCountsByReason,
} from '../../src/modules/notifications/repo.js'
import { notifyUser } from '../../src/modules/notifications/notify.js'
import { _internal } from '../../src/modules/notifications/jobs.js'

describe('personal digest schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T03:30:00Z'))
    vi.mocked(unreadCountsByReason).mockResolvedValue({ due: 2 })
  })
  afterEach(() => vi.useRealTimers())
  const log = { info: vi.fn() } as unknown as FastifyBaseLogger
  function preference(mode: 'daily' | 'weekly' | 'off') {
    vi.mocked(getPrefs).mockResolvedValue([
      { reason: 'digest', channel: 'telegram', enabled: mode !== 'off', digestMode: mode },
    ])
  }

  it('creates a daily digest with a Tashkent calendar date', async () => {
    preference('daily')
    await _internal.runDigestPersonal(log)
    expect(notifyUser).toHaveBeenCalledWith(
      log,
      expect.objectContaining({
        type: 'notifications.digest.daily',
        subjectId: 'daily-2026-10-08',
      }),
    )
  })
  it('creates a weekly digest on Friday only', async () => {
    preference('weekly')
    await _internal.runDigestPersonal(log)
    expect(notifyUser).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-09T03:30:00Z'))
    await _internal.runDigestPersonal(log)
    expect(notifyUser).toHaveBeenCalledWith(
      log,
      expect.objectContaining({
        type: 'notifications.digest.weekly',
        subjectId: 'weekly-2026-10-09',
      }),
    )
  })
  it('creates one summary when a person belongs to two departments', async () => {
    preference('daily')
    vi.mocked(listAllDepartmentIds).mockResolvedValueOnce(['department', 'second-department'])
    await _internal.runDigestPersonal(log)
    expect(notifyUser).toHaveBeenCalledOnce()
  })
  it('does not create recursive summaries or send an off preference', async () => {
    preference('daily')
    vi.mocked(unreadCountsByReason).mockResolvedValue({})
    await _internal.runDigestPersonal(log)
    expect(notifyUser).not.toHaveBeenCalled()
    preference('off')
    vi.mocked(unreadCountsByReason).mockResolvedValue({ due: 2 })
    await _internal.runDigestPersonal(log)
    expect(notifyUser).not.toHaveBeenCalled()
  })
})

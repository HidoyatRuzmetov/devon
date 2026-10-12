import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import type { RecurrenceRule } from '@devon/contracts'
import type { RecurringCardRow, ReminderOwner } from '../../src/modules/work/plus-repo.js'

vi.mock('../../src/modules/work/plus-repo.js', () => ({
  listRecurringCards: vi.fn(),
  listReminderOwners: vi.fn(),
  claimDueReminders: vi.fn(),
}))
vi.mock('../../src/modules/work/repo.js', () => ({ createCard: vi.fn() }))
vi.mock('../../src/modules/notifications/notify.js', () => ({ notifyUser: vi.fn() }))

import * as plus from '../../src/modules/work/plus-repo.js'
import { createCard } from '../../src/modules/work/repo.js'
import { notifyUser } from '../../src/modules/notifications/notify.js'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
const rule: RecurrenceRule = { freq: 'daily', interval: 1, mode: 'after_done' }
const oldDue = '2026-10-06T04:00:00.000Z'
const completed = '2026-10-09T09:41:32.000Z'
const base: RecurringCardRow = {
  id: 'card',
  departmentId: 'department',
  title: 'Review register',
  description: null,
  kind: 'task',
  assigneeUserId: 'owner',
  giverUserId: null,
  projectId: null,
  projectScope: 'none',
  priority: 'medium',
  labels: [],
  estimateMin: null,
  dueAt: oldDue,
  status: 'archived',
  doneAt: null,
  archivedAt: completed,
  recurrence: rule,
  recurrenceSeriesId: 'card',
  recurrenceIndex: 1,
  createdByUserId: 'owner',
  seriesCount: 1,
  hasNewerInstance: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('recurrence dates follow the selected workflow', () => {
  it.each([
    { status: 'archived' as const, doneAt: null, archivedAt: completed },
    { status: 'done' as const, doneAt: completed, archivedAt: null },
  ])(
    'counts after-done from actual $status completion, not its overdue date',
    async (completion) => {
      const { runRecurrenceScan } = await import('../../src/modules/work/jobs.js')
      vi.mocked(plus.listRecurringCards).mockResolvedValue([{ ...base, ...completion }])
      expect(await runRecurrenceScan(log)).toBe(1)
      expect(createCard).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          dueAt: '2026-10-10T09:41:00.000Z',
          recurrenceIndex: 2,
        }),
      )
    },
  )

  it('keeps scheduled due time independently of a later completion', async () => {
    const { runRecurrenceScan } = await import('../../src/modules/work/jobs.js')
    vi.mocked(plus.listRecurringCards).mockResolvedValue([
      { ...base, recurrence: { ...rule, mode: 'schedule' } },
    ])
    expect(await runRecurrenceScan(log)).toBe(1)
    expect(createCard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dueAt: '2026-10-07T04:00:00.000Z',
      }),
    )
  })

  it('does not invent a completion date, repeat active work, exceed count, or duplicate a successor', async () => {
    const { nextInstanceDueAt } = await import('../../src/modules/work/jobs.js')
    expect(nextInstanceDueAt(rule, { ...base, doneAt: null, archivedAt: null })).toBeNull()
    expect(nextInstanceDueAt(rule, { ...base, status: 'active' })).toBeNull()
    expect(nextInstanceDueAt({ ...rule, count: 1 }, base)).toBeNull()
    expect(nextInstanceDueAt(rule, { ...base, hasNewerInstance: true })).toBeNull()
    expect(nextInstanceDueAt({ ...rule, until: '2026-10-09' }, base)).toBeNull()
  })
})

describe('bounded owner-scoped reminder scans', () => {
  const owners: ReminderOwner[] = [
    { departmentId: 'a', userId: 'first', role: 'member' },
    { departmentId: 'b', userId: 'second', role: 'head' },
  ]
  const reminders = (userId: string, departmentId: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${userId}-${i}`,
      departmentId,
      userId,
      cardId: `card-${i}`,
      note: null,
      cardTitle: 'Review',
    }))

  it('claims private content under each exact owner and department, then delivers only those claims', async () => {
    const { runReminderScan } = await import('../../src/modules/work/jobs.js')
    vi.mocked(plus.listReminderOwners).mockResolvedValue(owners)
    vi.mocked(plus.claimDueReminders)
      .mockResolvedValueOnce(reminders('first', 'a', 2))
      .mockResolvedValueOnce(reminders('second', 'b', 1))
    expect(await runReminderScan(log)).toBe(3)
    expect(plus.listReminderOwners).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, departmentId: null, actorRole: 'super_admin' }),
      null,
      200,
    )
    expect(plus.claimDueReminders).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'first',
        departmentId: 'a',
        actorRole: null,
        departmentRole: 'member',
      }),
      100,
    )
    expect(plus.claimDueReminders).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'second',
        departmentId: 'b',
        actorRole: null,
        departmentRole: 'head',
      }),
      98,
    )
    expect(notifyUser).toHaveBeenCalledTimes(3)
    expect(notifyUser).toHaveBeenLastCalledWith(
      log,
      expect.objectContaining({
        userId: 'second',
        departmentId: 'b',
        type: 'work.card.reminder',
      }),
    )
  })

  it('continues beyond a backlogged first owner on the next tick instead of starving another department', async () => {
    const { runReminderScan } = await import('../../src/modules/work/jobs.js')
    vi.mocked(plus.listReminderOwners)
      .mockResolvedValueOnce(owners)
      .mockResolvedValueOnce([owners[1]!])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(owners)
    vi.mocked(plus.claimDueReminders)
      .mockResolvedValueOnce(reminders('first', 'a', 100))
      .mockResolvedValueOnce(reminders('second', 'b', 1))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    expect(await runReminderScan(log)).toBe(100)
    expect(plus.claimDueReminders).toHaveBeenCalledTimes(1)
    expect(await runReminderScan(log)).toBe(1)
    expect(plus.listReminderOwners).toHaveBeenNthCalledWith(2, expect.anything(), owners[0], 200)
    expect(await runReminderScan(log)).toBe(0)
    expect(plus.listReminderOwners).toHaveBeenNthCalledWith(3, expect.anything(), owners[1], 200)
    expect(plus.listReminderOwners).toHaveBeenNthCalledWith(4, expect.anything(), null, 200)
  })
})

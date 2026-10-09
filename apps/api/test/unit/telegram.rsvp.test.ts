import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot, Context } from 'grammy'

vi.mock('../../src/modules/telegram/repo.js', () => ({
  resolveUserByChatId: vi.fn().mockResolvedValue({ userId: 'linked-user', locale: 'en' }),
}))
vi.mock('../../src/modules/telegram/miniapp-buttons.js', () => ({
  miniappMenuKeyboard: () => null,
}))
vi.mock('../../src/modules/events/telegram-rsvp.js', () => ({ recordTelegramRsvp: vi.fn() }))
vi.mock('../../src/modules/notifications/repo.js', () => ({
  getNotificationById: vi.fn(),
  markRead: vi.fn().mockResolvedValue(1),
  systemAuditCtx: (userId: string) => ({ userId }),
}))
import { getNotificationById, markRead } from '../../src/modules/notifications/repo.js'
import { recordTelegramRsvp } from '../../src/modules/events/telegram-rsvp.js'
import { EventConflictError, EventForbiddenError } from '../../src/modules/events/errors.js'
import { registerBotHandlers } from '../../src/modules/telegram/bot.js'

const NOTIFICATION = '550e8400-e29b-41d4-a716-446655440000'
const EVENT = '550e8400-e29b-41d4-a716-446655440001'
const DEPARTMENT = '550e8400-e29b-41d4-a716-446655440002'

function callback(choice: 'yes' | 'no' | 'maybe' = 'yes') {
  const handlers = new Map<string, (ctx: Context) => Promise<void>>()
  registerBotHandlers({
    use: vi.fn(),
    command: vi.fn(),
    on: (name: string, fn: (ctx: Context) => Promise<void>) => handlers.set(name, fn),
  } as unknown as Bot)
  const answerCallbackQuery = vi.fn()
  const ctx = {
    chat: { id: 123, type: 'private' },
    callbackQuery: { data: `rsvp:${choice}:${NOTIFICATION}` },
    answerCallbackQuery,
  } as unknown as Context
  return { run: () => handlers.get('callback_query:data')!(ctx), answerCallbackQuery }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getNotificationById).mockResolvedValue({
    id: NOTIFICATION,
    subjectType: 'event',
    subjectId: EVENT,
    departmentId: DEPARTMENT,
  } as Awaited<ReturnType<typeof getNotificationById>>)
  vi.mocked(recordTelegramRsvp).mockResolvedValue({ myRsvp: { status: 'yes' } } as Awaited<
    ReturnType<typeof recordTelegramRsvp>
  >)
})

describe('Telegram RSVP acknowledgment at the excluded external boundary', () => {
  it('acknowledges only after the website RSVP service has committed', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof recordTelegramRsvp>>) => void
    vi.mocked(recordTelegramRsvp).mockImplementationOnce(
      () => new Promise((done) => (resolve = done)),
    )
    const action = callback()
    const operation = action.run()
    await vi.waitFor(() =>
      expect(recordTelegramRsvp).toHaveBeenCalledWith('linked-user', DEPARTMENT, EVENT, 'yes'),
    )
    expect(action.answerCallbackQuery).not.toHaveBeenCalled()
    expect(markRead).not.toHaveBeenCalled()
    resolve({ myRsvp: { status: 'yes' } } as Awaited<ReturnType<typeof recordTelegramRsvp>>)
    await operation
    expect(markRead).toHaveBeenCalledWith({ userId: 'linked-user' }, 'linked-user', [NOTIFICATION])
    expect(action.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Your answer was recorded: I'm going",
    })
  })

  it('reports the actual waitlist result instead of claiming a full event accepted Going', async () => {
    vi.mocked(recordTelegramRsvp).mockResolvedValueOnce({
      myRsvp: { status: 'waitlist' },
    } as Awaited<ReturnType<typeof recordTelegramRsvp>>)
    const action = callback()
    await action.run()
    expect(action.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Your answer was recorded: On the waitlist',
    })
  })

  it.each([
    [new EventConflictError('event_full'), 'No spots remain and the waitlist is closed.'],
    [
      new EventConflictError('rsvp_deadline_passed'),
      'The RSVP deadline has passed. You can still decline.',
    ],
    [new EventForbiddenError(), 'You cannot answer this event. Check its details in the app.'],
  ])('gives a useful refusal without a success reply for %s', async (error, message) => {
    vi.mocked(recordTelegramRsvp).mockRejectedValueOnce(error)
    const action = callback()
    await action.run()
    expect(action.answerCallbackQuery).toHaveBeenCalledWith({ text: message, show_alert: true })
    expect(markRead).not.toHaveBeenCalled()
  })

  it('retains an infrastructure failure for retry and never claims the answer was saved', async () => {
    vi.mocked(recordTelegramRsvp).mockRejectedValueOnce(new Error('Local database unavailable'))
    const action = callback()
    await expect(action.run()).rejects.toThrow('Local database unavailable')
    expect(action.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Your answer was not saved. Please try again shortly.',
      show_alert: true,
    })
    expect(markRead).not.toHaveBeenCalled()
  })

  it.each([null, { subjectType: 'card', subjectId: EVENT, departmentId: DEPARTMENT }])(
    'refuses a missing or non-event notification %s',
    async (notification) => {
      vi.mocked(getNotificationById).mockResolvedValueOnce(
        notification as Awaited<ReturnType<typeof getNotificationById>>,
      )
      const action = callback()
      await action.run()
      expect(recordTelegramRsvp).not.toHaveBeenCalled()
      expect(action.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'You cannot answer this event. Check its details in the app.',
        show_alert: true,
      })
    },
  )
})

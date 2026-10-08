import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot, Context } from 'grammy'

vi.mock('../../src/modules/telegram/repo.js', () => ({
  resolveUserByChatId: vi.fn().mockResolvedValue({ userId: 'owner', locale: 'en' }),
  setMutedUntil: vi.fn(),
  resolveGroupByChatId: vi.fn(),
  disconnectGroupByChatId: vi.fn(),
}))
vi.mock('../../src/modules/telegram/miniapp-buttons.js', () => ({
  miniappMenuKeyboard: () => null,
}))
vi.mock('../../src/modules/notifications/repo.js', () => ({
  archiveNotifications: vi.fn(),
  snoozeNotification: vi.fn(),
  getNotificationById: vi.fn(),
  emitActionRequested: vi.fn(),
  systemAuditCtx: vi.fn(),
}))
import {
  setMutedUntil,
  resolveGroupByChatId,
  disconnectGroupByChatId,
} from '../../src/modules/telegram/repo.js'
import {
  archiveNotifications,
  snoozeNotification,
  getNotificationById,
  emitActionRequested,
} from '../../src/modules/notifications/repo.js'
import { registerBotHandlers } from '../../src/modules/telegram/bot.js'

function handlers() {
  const commands = new Map<string, (ctx: Context) => Promise<void>>()
  const events = new Map<string, (ctx: Context) => Promise<void>>()
  registerBotHandlers({
    use: vi.fn(),
    command: (name: string, callback: (ctx: Context) => Promise<void>) =>
      commands.set(name, callback),
    on: (name: string, callback: (ctx: Context) => Promise<void>) => events.set(name, callback),
  } as unknown as Bot)
  return { commands, events }
}

describe('Telegram malformed inputs do not stall update consumption', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each(['', '-1', '2.5', '30minutes', '99999999999999999999999999999', '43201'])(
    'refuses malformed or unbounded mute duration %s with a useful reply',
    async (match) => {
      const reply = vi.fn()
      await handlers().commands.get('mute')!({
        chat: { id: 123, type: 'private' },
        match,
        reply,
      } as unknown as Context)
      expect(setMutedUntil).not.toHaveBeenCalled()
      expect(reply).toHaveBeenCalledOnce()
    },
  )
  it.each(['0', '30', '43200'])(
    'accepts mute duration %s within the same bounds as the HTTP endpoint',
    async (match) => {
      const reply = vi.fn()
      await handlers().commands.get('mute')!({
        chat: { id: 123, type: 'private' },
        match,
        reply,
      } as unknown as Context)
      expect(setMutedUntil).toHaveBeenCalledWith('owner', match === '0' ? null : expect.any(Date))
    },
  )
  it.each([
    'done:bad-id',
    'snooze:bad-id',
    'rsvp:unknown:550e8400-e29b-41d4-a716-446655440000',
    'rsvp:yes:bad-id',
  ])('acknowledges malformed callback %s without a failing database mutation', async (data) => {
    const answerCallbackQuery = vi.fn()
    await handlers().events.get('callback_query:data')!({
      chat: { id: 123, type: 'private' },
      callbackQuery: { data },
      answerCallbackQuery,
    } as unknown as Context)
    expect(archiveNotifications).not.toHaveBeenCalled()
    expect(snoozeNotification).not.toHaveBeenCalled()
    expect(getNotificationById).not.toHaveBeenCalled()
    expect(emitActionRequested).not.toHaveBeenCalled()
    expect(answerCallbackQuery).toHaveBeenCalledOnce()
  })
  it('retains a group-removal update for retry when its database disconnect fails', async () => {
    vi.mocked(resolveGroupByChatId).mockResolvedValueOnce({ departmentId: 'department', kinds: [] })
    vi.mocked(disconnectGroupByChatId).mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(
      handlers().events.get('my_chat_member')!({
        chat: { id: -123, type: 'supergroup' },
        myChatMember: { new_chat_member: { status: 'left' } },
      } as unknown as Context),
    ).rejects.toThrow('Database unavailable')
  })
})

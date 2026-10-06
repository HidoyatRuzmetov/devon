import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot, Context } from 'grammy'

vi.mock('../../src/modules/telegram/repo.js', () => ({
  consumeLinkCode: vi.fn().mockResolvedValue({ ok: true, userId: 'user' }),
}))
vi.mock('../../src/modules/telegram/miniapp-buttons.js', () => ({
  miniappMenuKeyboard: () => null,
}))

import { consumeLinkCode } from '../../src/modules/telegram/repo.js'
import { registerBotHandlers } from '../../src/modules/telegram/bot.js'

describe('Telegram personal linking', () => {
  beforeEach(() => vi.clearAllMocks())

  function startHandler() {
    const handlers = new Map<string, (ctx: Context) => Promise<void>>()
    registerBotHandlers({
      use: vi.fn(),
      on: vi.fn(),
      command: (name: string, handler: (ctx: Context) => Promise<void>) =>
        handlers.set(name, handler),
    } as unknown as Bot)
    return handlers.get('start')!
  }

  it.each(['group', 'supergroup'])(
    'cannot deliver personal reminders or reset codes to a %s',
    async (type) => {
      await startHandler()({
        chat: { id: -123, type },
        match: 'ABCDEFGH',
        from: { language_code: 'en' },
      } as unknown as Context)
      expect(consumeLinkCode).not.toHaveBeenCalled()
    },
  )

  it('allows a one-time code in the account owner’s private bot chat', async () => {
    const reply = vi.fn()
    await startHandler()({
      chat: { id: 123, type: 'private' },
      match: 'ABCDEFGH',
      from: { language_code: 'en', first_name: 'Demo' },
      reply,
    } as unknown as Context)
    expect(consumeLinkCode).toHaveBeenCalledWith('ABCDEFGH', '123', 'en')
    expect(reply).toHaveBeenCalledOnce()
  })
})

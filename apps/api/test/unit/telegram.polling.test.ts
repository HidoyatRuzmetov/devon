import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bot } from 'grammy'

const state = vi.hoisted(() => ({
  acquired: true,
  clients: [] as Array<{
    emit: (event: string, error: Error) => boolean
    end: ReturnType<typeof vi.fn>
  }>,
  resume: [] as Array<() => void>,
}))
vi.mock('pg', () => ({
  Client: class extends EventEmitter {
    connect = vi.fn().mockResolvedValue(undefined)
    query = vi.fn(async () => ({ rows: [{ acquired: state.acquired }] }))
    end = vi.fn(async () => {
      this.emit('end')
    })
    constructor() {
      super()
      state.clients.push(this)
    }
  },
}))
vi.mock('node:timers/promises', () => ({
  setTimeout: (_ms: number, _value: unknown, { signal }: { signal: AbortSignal }) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      state.resume.push(resolve)
    }),
}))
import {
  isTelegramPollingHealthy,
  startTelegramPolling,
} from '../../src/modules/telegram/polling.js'

describe('explicit Telegram polling leadership and acknowledgement', () => {
  let handle: ReturnType<typeof startTelegramPolling> | undefined
  const log = { info: vi.fn(), error: vi.fn() }
  function botFixture() {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      api: {
        deleteWebhook: vi.fn().mockResolvedValue(true),
        getUpdates: vi.fn(
          (_options: unknown, signal: AbortSignal) =>
            new Promise<unknown[]>((_resolve, reject) => {
              if (signal.aborted) {
                reject(new Error('aborted'))
                return
              }
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            }),
        ),
      },
      handleUpdate: vi.fn().mockResolvedValue(undefined),
    }
  }
  beforeEach(() => {
    state.acquired = true
    state.clients.length = 0
    state.resume.length = 0
    vi.clearAllMocks()
  })
  afterEach(async () => {
    await handle?.stop()
    handle = undefined
  })
  const config = { DATABASE_URL: 'postgres://dummy@fixture/db', TELEGRAM_BOT_TOKEN: '123:dummy' }

  it('a standby never deletes the webhook or consumes updates', async () => {
    state.acquired = false
    const bot = botFixture()
    handle = startTelegramPolling(bot as unknown as Bot, config, log)
    await vi.waitFor(() => expect(state.clients[0]?.end).toHaveBeenCalledOnce())
    expect(bot.api.deleteWebhook).not.toHaveBeenCalled()
    expect(bot.api.getUpdates).not.toHaveBeenCalled()
    expect(isTelegramPollingHealthy()).toBe(false)
  })

  it('preserves pending messages and aborts active polling on graceful shutdown', async () => {
    const bot = botFixture()
    handle = startTelegramPolling(bot as unknown as Bot, config, log)
    await vi.waitFor(() => expect(bot.api.getUpdates).toHaveBeenCalledOnce())
    expect(bot.api.deleteWebhook).toHaveBeenCalledWith(
      { drop_pending_updates: false },
      expect.any(AbortSignal),
    )
    await handle.stop()
    expect(state.clients[0]!.end).toHaveBeenCalledOnce()
    expect(isTelegramPollingHealthy()).toBe(false)
  })

  it('retries a failed command before advancing the acknowledgement offset', async () => {
    const bot = botFixture()
    bot.api.getUpdates
      .mockResolvedValueOnce([{ update_id: 100 }])
      .mockResolvedValueOnce([{ update_id: 100 }])
    bot.handleUpdate.mockRejectedValueOnce(new Error('database unavailable'))
    handle = startTelegramPolling(bot as unknown as Bot, config, log)
    await vi.waitFor(() => expect(state.resume).toHaveLength(1))
    expect(isTelegramPollingHealthy()).toBe(false)
    state.resume.shift()!()
    await vi.waitFor(() => expect(bot.api.getUpdates).toHaveBeenCalledTimes(3))
    expect(
      bot.api.getUpdates.mock.calls.map(([options]) => (options as { offset: number }).offset),
    ).toEqual([0, 0, 101])
    expect(bot.handleUpdate).toHaveBeenCalledTimes(2)
    expect(isTelegramPollingHealthy()).toBe(true)
  })

  it('losing the lock session immediately cancels the Telegram request', async () => {
    const bot = botFixture()
    handle = startTelegramPolling(bot as unknown as Bot, config, log)
    await vi.waitFor(() => expect(bot.api.getUpdates).toHaveBeenCalledOnce())
    const signal = bot.api.getUpdates.mock.calls[0]![1]
    state.clients[0]!.emit('error', new Error('connection lost'))
    expect(signal.aborted).toBe(true)
    await vi.waitFor(() => expect(state.clients[0]!.end).toHaveBeenCalledOnce())
    expect(bot.api.getUpdates).toHaveBeenCalledOnce()
  })
})

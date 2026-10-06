import { createHash } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { Client } from 'pg'
import type { Bot } from 'grammy'
import type { FastifyBaseLogger } from 'fastify'

let healthyAt = 0
export function isTelegramPollingHealthy(): boolean {
  return healthyAt > 0 && Date.now() - healthyAt < 30_000
}

/** One dedicated session owns the bot. Losing PostgreSQL leadership aborts Telegram immediately.
 * No webhook is deleted until explicit polling configuration AND the advisory lock are present. */
export function startTelegramPolling(
  bot: Bot,
  config: { DATABASE_URL: string; TELEGRAM_BOT_TOKEN?: string | undefined },
  log: Pick<FastifyBaseLogger, 'info' | 'error'>,
): { stop(): Promise<void> } {
  const shutdown = new AbortController()
  let active: AbortController | null = null
  let offset = 0
  const lock = `devon.telegram.polling:${createHash('sha256')
    .update(config.TELEGRAM_BOT_TOKEN ?? '')
    .digest('hex')}`
  const stopped = (async () => {
    while (!shutdown.signal.aborted) {
      const client = new Client({
        connectionString: config.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 5000,
      })
      const attempt = new AbortController()
      // grammY types reference its legacy abort-controller polyfill. Native Node signals implement
      // the same runtime abort contract; only the polyfill's dispatchEvent typing differs.
      const apiSignal = attempt.signal as unknown as Parameters<Bot['api']['getUpdates']>[1]
      active = attempt
      client.on('error', () => attempt.abort())
      client.on('end', () => attempt.abort())
      try {
        // A leader election must retry sequentially; never issue overlapping lock attempts.
        // nosemgrep: query-in-loop
        await client.connect()
        // nosemgrep: query-in-loop
        const elected = await client.query<{ acquired: boolean }>(
          'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
          [lock],
        )
        if (!elected.rows[0]?.acquired) throw new Error('Polling leadership unavailable')
        if (shutdown.signal.aborted || attempt.signal.aborted) break
        // nosemgrep: query-in-loop
        await bot.init()
        if (shutdown.signal.aborted || attempt.signal.aborted) break
        // nosemgrep: query-in-loop
        await bot.api.deleteWebhook({ drop_pending_updates: false }, apiSignal)
        log.info({}, 'telegram: explicit polling leader started')
        let retryDelay = 1000
        while (!shutdown.signal.aborted && !attempt.signal.aborted) {
          try {
            // Telegram offsets are sequential acknowledgements, not independent queries.
            // nosemgrep: query-in-loop
            const updates = await bot.api.getUpdates({ offset, limit: 20, timeout: 5 }, apiSignal)
            healthyAt = Date.now()
            // Offset acknowledgement is ordered: later updates cannot overtake a failed command.
            for (const update of updates) {
              if (shutdown.signal.aborted || attempt.signal.aborted) break
              // A failed command is retried before advancing its acknowledgement offset.
              // eslint-disable-next-line no-restricted-syntax -- Telegram offsets require ordered delivery before acknowledgement.
              await bot.handleUpdate(update) // nosemgrep: query-in-loop
              offset = update.update_id + 1
            }
            retryDelay = 1000
          } catch {
            healthyAt = 0
            if (shutdown.signal.aborted || attempt.signal.aborted) break
            log.error({}, 'telegram: polling delivery failed; retrying without discarding updates')
            // nosemgrep: query-in-loop
            await pause(retryDelay, undefined, { signal: attempt.signal })
            retryDelay = Math.min(retryDelay * 2, 20_000)
          }
        }
      } catch {
        if (!shutdown.signal.aborted)
          log.error({}, 'telegram: polling leadership unavailable; retrying')
      } finally {
        healthyAt = 0
        attempt.abort()
        // Closing this dedicated session atomically releases its advisory lock.
        // nosemgrep: query-in-loop
        await client.end().catch(() => {})
      }
      if (!shutdown.signal.aborted) {
        // nosemgrep: query-in-loop
        await pause(5000, undefined, { signal: shutdown.signal }).catch(() => {})
      }
    }
  })()
  return {
    stop: async () => {
      shutdown.abort()
      active?.abort()
      await stopped
    },
  }
}

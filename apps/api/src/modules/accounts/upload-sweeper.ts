// Retention sweep for abandoned uploads (TECH-SPEC §6 `retention.sweep`: "notifications, sessions,
// temp uploads only"; H11.1 bounded growth). A presigned URL that was issued but never finalised
// leaves a `pending` row in `app.uploads` and, if the browser did upload before giving up, an
// orphaned object under a key nobody will ever finalise. Once an hour this flips every such row past
// its `expires_at` to `expired` and deletes the bytes (`sweepExpiredUploads`, avatar-service.ts).
//
// Same shape and same rule as `modules/events/reminder-worker.ts`: started exactly once from
// `apps/api/src/server.ts`, never from `app.ts`, so a `buildApp()` in a unit test never owns a timer.
import type { FastifyInstance } from 'fastify'
import { sweepExpiredUploads } from './avatar-service.js'

export type UploadSweeperHandle = { stop(): void }

export function startUploadSweeper(
  app: FastifyInstance,
  options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
): UploadSweeperHandle {
  const intervalMs = options.intervalMs ?? 60 * 60 * 1000
  let running = false

  async function tick(): Promise<void> {
    if (running) return // a slow sweep never overlaps the next tick
    running = true
    try {
      const expired = await sweepExpiredUploads(app)
      if (expired > 0) app.log.info({ expired }, 'storage: expired abandoned uploads')
    } catch (err) {
      options.onError?.(err)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref() // never the thing keeping the process alive
  void tick() // one pass at boot, so a restart clears anything the last process left behind

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

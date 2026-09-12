// H8.1 graceful degradation: retries every avatar upload the ClamAV-outage path in `avatar-service.ts`
// left `pending` (`ScannerUnavailable`/circuit-open), so a transient or even multi-minute ClamAV outage
// resolves itself automatically -- the user never has to re-upload their photo, and no scan ever
// happens outside `finalizeAvatar`'s existing "nothing visible before a clean verdict" pipeline.
//
// A short interval (30s, not the hourly `upload-sweeper.ts` cadence) on purpose: uploads only stay
// `pending` for at most their 10-minute presigned-URL window before the sweeper deletes them, so a
// retry loop that only ran once an hour would almost never actually recover one in time. Same shape as
// `upload-sweeper.ts`/`events/reminder-worker.ts`: started exactly once from `apps/api/src/server.ts`,
// never from `app.ts`, so a `buildApp()` in a unit test never owns a timer (H11.1 "timers cleared").
import type { FastifyInstance } from 'fastify'
import { retryPendingScans } from './avatar-service.js'

export type ScanRetryWorkerHandle = { stop(): void }

export function startScanRetryWorker(
  app: FastifyInstance,
  options: { intervalMs?: number; limit?: number; onError?: (err: unknown) => void } = {},
): ScanRetryWorkerHandle {
  const intervalMs = options.intervalMs ?? 30_000
  const limit = options.limit ?? 25
  let running = false

  async function tick(): Promise<void> {
    if (running) return // a slow retry pass never overlaps the next tick
    running = true
    try {
      const summary = await retryPendingScans(app, limit)
      if (summary.finalized > 0 || summary.stillPending > 0) {
        app.log.info(summary, 'storage: avatar scan retry pass')
      }
    } catch (err) {
      options.onError?.(err)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref() // never the thing keeping the process alive
  void tick() // one pass at boot, so a restart resumes any retry the previous process was mid-way through

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

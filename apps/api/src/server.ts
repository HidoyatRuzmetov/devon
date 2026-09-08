// Process entry point. The only file in this package allowed to read `process.env` or open a real
// database connection -- everything else takes `Config`/`Deps` as parameters (see `src/app.ts`).
import { startEventsWorker } from '@devon/db'
import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { createRepo } from './db/repo.js'
import { printSetupUrlIfNeeded } from './bootstrap/print-setup-url.js'
import { startEventReminderWorker } from './modules/events/reminder-worker.js'
import { startUploadSweeper } from './modules/accounts/upload-sweeper.js'
import { startScanRetryWorker } from './modules/accounts/scan-retry-worker.js'
import { registerGracefulShutdown } from './plugins/shutdown.js'

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const deps = createRepo()
  const app = await buildApp(deps, config)
  await printSetupUrlIfNeeded(app, deps, config)

  // MODULE-GUIDE.md "Domain events": the outbox drain is documented as starting here but was not
  // actually wired up yet -- found while building EPIC-008, which depends on it to ever deliver a
  // domain event to a subscriber (e.g. the inbox module). Fixed at the root cause rather than routed
  // around, per this module's own build instructions. Never started from `app.ts`, so
  // `buildApp()`-based unit tests never pick up a background timer.
  const outboxWorker = startEventsWorker({
    onError: (err) => app.log.error(err, 'outbox drain failed'),
  })
  const reminderWorker = startEventReminderWorker({
    onError: (err) => app.log.error(err, 'event reminder scan failed'),
  })
  // EPIC-001 storage plugin: hourly retention sweep of abandoned presigned uploads (TECH-SPEC §6
  // `retention.sweep`), same start-here-only rule as the two workers above.
  const uploadSweeper = startUploadSweeper(app, {
    onError: (err) => app.log.error(err, 'upload retention sweep failed'),
  })
  // H8.1: recovers avatar uploads a ClamAV outage left `pending` well before their 10-minute window
  // expires (see `scan-retry-worker.ts`'s header) -- same start-here-only rule as the three workers
  // above.
  const scanRetryWorker = startScanRetryWorker(app, {
    onError: (err) => app.log.error(err, 'avatar scan retry pass failed'),
  })
  app.addHook('onClose', async () => {
    outboxWorker.stop()
    reminderWorker.stop()
    uploadSweeper.stop()
    scanRetryWorker.stop()
  })

  // H13.1 "graceful shutdown drains in-flight requests and jobs" / "safe restart": SIGTERM (docker
  // stop, a supervisor restart) and SIGINT (Ctrl-C in a foreground dev run) both now drain instead of
  // killing every in-flight request and background job outright -- see `plugins/shutdown.ts`'s header
  // for what was silently never running before this.
  registerGracefulShutdown(app)

  await app.listen({ port: config.API_PORT, host: '0.0.0.0' })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})

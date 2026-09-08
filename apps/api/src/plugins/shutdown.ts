// H13.1 "graceful shutdown drains in-flight requests and jobs": nothing in this process previously
// listened for SIGTERM/SIGINT at all, so `docker stop` (which sends SIGTERM, then SIGKILL after
// Docker's own default 10s grace period) hit Node's default signal action -- immediate process
// termination -- and none of `app.ts`'s already-correct `onClose` hooks (pg-boss's own
// `stop({graceful:true})` in `notifications/index.ts`, the outbox/reminder/upload-sweep/scan-retry
// workers' `clearInterval`s in `server.ts`, the storage client's socket close in `plugins/storage.ts`,
// the Telegram long-polling stop in `modules/telegram/index.ts`) ever ran: every in-flight HTTP
// request was cut mid-response and every in-flight background job/timer was killed mid-tick, on every
// single restart or redeploy.
//
// Deliberately a plain function called once from `server.ts` (the process entry point), never a
// Fastify plugin registered inside `buildApp()` -- `buildApp()` also backs every unit test
// (`test/unit/test-app.ts`), and a `process.on(...)` listener attached on every one of those calls
// would pile up across a test file's many `buildApp()` invocations, eventually tripping Node's
// MaxListenersExceededWarning and leaking closures that hold a *different* test's `app` alive.
import type { FastifyInstance } from 'fastify'
import { closePool } from '@devon/db'

export type GracefulShutdownOptions = {
  /** Hard ceiling on the whole drain (H13.1 "safe restart" must still actually finish a restart, not
   * hang forever behind one wedged connection). Default comfortably under Docker's own 10s
   * SIGTERM-to-SIGKILL grace period is too tight for a slow DB drain, so this defaults higher and the
   * deployment's own stop-grace-period (`infra/docker-compose.yml`) is the outer bound instead. */
  timeoutMs?: number
  signals?: readonly NodeJS.Signals[]
  /** Test-only seam: `process.exit` calls are notoriously hard to assert around in a test process, so
   * this defaults to the real thing but the resilience unit tests inject a spy instead. */
  exit?: (code: number) => void
}

export type GracefulShutdownHandle = {
  /** Removes the signal listeners this call installed -- used by the one test that boots a real
   * listener pair, never by production code (the process exits before it would matter there). */
  unregister(): void
}

/**
 * Installs SIGTERM/SIGINT handlers that drain the given Fastify instance exactly once, then close the
 * Postgres pool (`@devon/db`'s `closePool()` -- module-global, so outside Fastify's own `onClose`
 * chain, H11.1 "sockets closed"), then exit. A second signal while a drain is already in progress is
 * a no-op (idempotent -- an impatient double Ctrl-C or a supervisor that sends both SIGTERM and
 * SIGINT must never race two overlapping `app.close()` calls against the same instance).
 */
export function registerGracefulShutdown(
  app: FastifyInstance,
  options: GracefulShutdownOptions = {},
): GracefulShutdownHandle {
  const timeoutMs = options.timeoutMs ?? 25_000
  const signals = options.signals ?? (['SIGTERM', 'SIGINT'] as const)
  const exit = options.exit ?? ((code: number) => process.exit(code))
  let shuttingDown = false

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      app.log.warn({ signal }, 'shutdown: signal received again while already draining -- ignored')
      return
    }
    shuttingDown = true
    app.log.info({ signal, timeoutMs }, 'shutdown: draining in-flight requests and background jobs')

    // Deliberately NOT `.unref()`'d: it is always `clearTimeout`'d on both the success and failure
    // paths below before this function returns, so it never delays a clean exit by even one tick --
    // but it is exactly the thing that must keep the process alive long enough to fire in the one
    // case it exists for (a wedged `app.close()` that never settles), which an `unref()`'d timer is
    // not guaranteed to do once nothing else is holding the event loop open (verified: in a bare
    // process with no other refed handle, an `unref()`'d timer can lose the race against the process
    // deciding there is nothing left to wait for).
    const forceExitTimer = setTimeout(() => {
      app.log.error({ timeoutMs }, 'shutdown: drain exceeded its deadline -- forcing exit')
      exit(1)
    }, timeoutMs)

    try {
      // `app.close()` stops accepting new connections, waits for in-flight requests to finish, then
      // runs every `onClose` hook in reverse registration order -- pg-boss's graceful stop, the four
      // interval-based workers' `clearInterval`s, the storage client's socket close, and the Telegram
      // long-polling stop are ALL already correct and already registered; they were simply never
      // reached because nothing ever called this.
      await app.close()
      // The Postgres pool is `@devon/db`'s own module-private singleton (`context.ts`), never
      // Fastify-decorated, so it needs its own explicit close here rather than an `onClose` hook.
      await closePool()
      clearTimeout(forceExitTimer)
      app.log.info('shutdown: drained cleanly')
      exit(0)
    } catch (err) {
      clearTimeout(forceExitTimer)
      app.log.error({ err }, 'shutdown: error while draining -- exiting anyway')
      exit(1)
    }
  }

  const installed = signals.map((signal) => {
    const handler = (): void => {
      void shutdown(signal)
    }
    process.on(signal, handler)
    return { signal, handler }
  })

  return {
    unregister() {
      for (const { signal, handler } of installed) process.removeListener(signal, handler)
    },
  }
}

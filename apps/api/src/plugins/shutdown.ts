// H13.1 "graceful shutdown drains in-flight requests and jobs" / H18.1 "safe restart": nothing in
// this process previously listened for SIGTERM/SIGINT at all, so `docker stop` (which sends SIGTERM,
// then SIGKILL after the stop grace period) hit Node's default signal action -- immediate process
// termination -- and none of `app.ts`'s already-correct `onClose` hooks (pg-boss's own
// `stop({graceful:true})` in `notifications/index.ts`, the outbox/reminder/upload-sweep/scan-retry
// workers' `clearInterval`s in `server.ts`, the storage client's socket close in `plugins/storage.ts`,
// the Telegram long-polling stop in `modules/telegram/index.ts`) ever ran: every in-flight HTTP
// request was cut mid-response and every in-flight background job/timer was killed mid-tick, on every
// single restart or redeploy.
//
// The drain itself lives in `../bootstrap/graceful-shutdown.ts` (one implementation, injectable
// process/clock, force-exit budget, idempotent across repeated signals). This file is the
// Fastify-shaped wrapper the process entry point actually calls: it binds that drain to
// `app.close()` + `@devon/db`'s module-private pool, and hands back an `unregister()` because the
// listeners it installs go on the real `process`.
//
// Deliberately a plain function called once from `server.ts` (the process entry point), never a
// Fastify plugin registered inside `buildApp()` -- `buildApp()` also backs every unit test
// (`test/unit/test-app.ts`), and a `process.on(...)` listener attached on every one of those calls
// would pile up across a test file's many `buildApp()` invocations, eventually tripping Node's
// MaxListenersExceededWarning and leaking closures that hold a *different* test's `app` alive.
import type { FastifyInstance } from 'fastify'
import { closePool } from '@devon/db'
import {
  registerGracefulShutdown as registerDrain,
  type ShutdownProcess,
  type ShutdownSignal,
} from '../bootstrap/graceful-shutdown.js'

export type GracefulShutdownOptions = {
  /** Hard ceiling on the whole drain (H13.1 "safe restart" must still actually finish a restart, not
   * hang forever behind one wedged connection). Defaults to the drain's own 25 s budget, which sits
   * inside the 30 s `stop_grace_period` of infra/docker-compose.prod.yml. */
  timeoutMs?: number
  signals?: readonly ShutdownSignal[]
  /** Test-only seam: `process.exit` calls are notoriously hard to assert around in a test process, so
   * this defaults to the real thing but the resilience unit tests inject a spy instead. */
  exit?: (code: number) => void
}

export type GracefulShutdownHandle = {
  /** Removes the signal listeners this call installed -- used by the tests that boot a real listener
   * pair, never by production code (the process exits before it would matter there). */
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
  const installed: Array<{ signal: ShutdownSignal; handler: () => void }> = []
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const proc: ShutdownProcess = {
    on(signal, listener) {
      const handler = (): void => {
        listener()
      }
      installed.push({ signal, handler })
      process.on(signal, handler)
      return proc
    },
    exit,
  }

  registerDrain({
    log: app.log,
    close: async () => {
      // `app.close()` stops accepting new connections, waits for in-flight requests to finish, then
      // runs every `onClose` hook in reverse registration order -- pg-boss's graceful stop, the four
      // interval-based workers' `clearInterval`s, the storage client's socket close, and the Telegram
      // long-polling stop are ALL already correct and already registered; they were simply never
      // reached because nothing ever called this.
      await app.close()
      // The Postgres pool is `@devon/db`'s own module-private singleton (`context.ts`), never
      // Fastify-decorated, so it needs its own explicit close here rather than an `onClose` hook.
      await closePool()
    },
    proc,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signals === undefined ? {} : { signals: options.signals }),
  })

  return {
    unregister() {
      for (const { signal, handler } of installed) process.removeListener(signal, handler)
    },
  }
}

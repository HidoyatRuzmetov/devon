// Process-lifecycle hook for `src/server.ts` (HARDENING.md H18.1 "graceful shutdown", H13.1 "safe
// restart"). On SIGTERM (`docker stop`, systemd, Compose rolling restart) or SIGINT (Ctrl+C) it runs
// the supplied `close()` -- in production that is Fastify's `app.close()`, which stops accepting new
// connections, lets in-flight requests finish, and runs every registered `onClose` hook: the outbox /
// reminder / upload-sweep timers stopped in `server.ts`, the pg-boss runners' graceful stop in the
// notifications and analytics modules, the storage plugin's `store.close()` -- then exits 0.
//
// If `close()` has not settled within `timeoutMs` the process exits 1 anyway, so one stuck hook can
// never hold the container past its stop grace period: 25 s here against the 30 s `stop_grace_period`
// in infra/docker-compose.prod.yml, after which Docker SIGKILLs and nothing gets to log why. A second
// signal while the first is being handled is logged and ignored -- it never re-enters `close()`, never
// restarts the timer and never exits early.
//
// Everything process-shaped is injectable (`proc`) so the unit tests drive an EventEmitter with a
// recording `exit` instead of the real `process`; `server.ts` is the only caller that passes the real
// one (its header: the one file in this package that touches the process environment).
import type { FastifyBaseLogger } from 'fastify'

export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number]

/** Force-exit budget. Comfortably under Compose's 30 s `stop_grace_period`, leaving room for Docker's
 * signal-delivery latency and the logger's final flush. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000

/** The slice of `process` this module touches -- nothing else. */
export type ShutdownProcess = {
  on(signal: ShutdownSignal, listener: () => void): unknown
  exit(code: number): void
}

export type GracefulShutdownOptions = {
  /** Runs at most once per process. Production passes `app.close()` (plus the pool's `end()`). */
  close: () => Promise<unknown>
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>
  /** Defaults to the real `process`. Tests pass a fake. */
  proc?: ShutdownProcess
  /** Defaults to `DEFAULT_SHUTDOWN_TIMEOUT_MS`. */
  timeoutMs?: number
  /** Defaults to `SHUTDOWN_SIGNALS`. */
  signals?: readonly ShutdownSignal[]
}

export type GracefulShutdownHandle = {
  /** Starts the shutdown as if `signal` had been delivered, or joins the one already running. Resolves
   * once `proc.exit()` has been called (clean close, failed close or timeout). */
  trigger(signal: ShutdownSignal): Promise<void>
  /** True from the first signal onwards. */
  readonly inProgress: boolean
}

export function registerGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdownHandle {
  const {
    close,
    log,
    proc = process,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    signals = SHUTDOWN_SIGNALS,
  } = options

  let shutdown: Promise<void> | null = null

  const run = (signal: ShutdownSignal): Promise<void> => {
    let exited = false
    const exitOnce = (code: number): void => {
      if (exited) return
      exited = true
      proc.exit(code)
    }

    log.info({ signal, timeoutMs }, 'shutdown: signal received, closing')
    const forceExit = setTimeout(() => {
      log.error({ signal, timeoutMs }, 'shutdown: close did not finish in time, forcing exit')
      exitOnce(1)
    }, timeoutMs)
    // Never the thing keeping the process alive: if `close()` hangs on nothing at all (an unsettled
    // promise with no pending I/O behind it) Node may exit on its own instead of waiting out the
    // timer; the timer only matters when something real is stuck.
    forceExit.unref()

    return close().then(
      () => {
        clearTimeout(forceExit)
        if (exited) return
        log.info({ signal }, 'shutdown: closed cleanly')
        exitOnce(0)
      },
      (err: unknown) => {
        clearTimeout(forceExit)
        if (exited) return
        log.error({ err, signal }, 'shutdown: close failed')
        exitOnce(1)
      },
    )
  }

  const trigger = (signal: ShutdownSignal): Promise<void> => {
    if (shutdown) {
      log.warn({ signal }, 'shutdown: already in progress, ignoring repeated signal')
      return shutdown
    }
    shutdown = run(signal)
    return shutdown
  }

  for (const signal of signals) {
    proc.on(signal, () => {
      void trigger(signal)
    })
  }

  return {
    trigger,
    get inProgress() {
      return shutdown !== null
    },
  }
}

// Process-fatal handlers (HARDENING H16.1: "no swallowed exceptions; unhandled rejection handler that
// logs and exits cleanly").
//
// `server.ts`'s `main().catch()` only covers a failure during boot. After boot, Node's default for an
// unhandled rejection is to print a warning and *keep running*, and for an uncaught exception to die
// with a bare stack on stderr and no structured record. Either way the operator is left with a
// process in a state nobody can reason about.
//
// Both are treated as fatal on purpose. A rejection nobody awaited means an invariant this code
// believes in did not hold; continuing to serve requests from a process whose state is no longer
// understood is worse, for a system holding one ministry's work, than the restart the supervisor
// performs in a second (`restart: unless-stopped`, infra/docker-compose.yml). Exit code 1 so the
// supervisor reads it as a crash and not a clean stop.
//
// Lives here rather than inline in `server.ts` so it can be unit-tested against a fake process
// without a test ever installing a real handler that calls `process.exit`.

/** pino's numeric level for `fatal`, so this line sorts with the app's own logs. */
const FATAL_LEVEL = 60

export type FatalKind = 'unhandledRejection' | 'uncaughtException'

/**
 * One line of JSON in pino's shape. Deliberately built by hand rather than through the app logger:
 * this path has to work when the failure *is* the logger, and it must not await anything that could
 * itself reject.
 *
 * The message and stack are the process's own, never a request's: nothing here is interpolated from
 * user input, so this line cannot be used to smuggle content past `lib/log-redaction.ts` (H1.11).
 */
export function formatFatal(kind: FatalKind, err: unknown, now: number = Date.now()): string {
  return JSON.stringify({
    level: FATAL_LEVEL,
    time: now,
    msg: `fatal: ${kind}`,
    err: {
      type: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    },
  })
}

/** The subset of `process` this needs -- so a test can pass a fake one. */
export type FatalTarget = {
  on(event: FatalKind, listener: (value: unknown) => void): unknown
  exit(code: number): never
  exitCode?: number | string | null | undefined
}

/**
 * Installs both handlers on `target`. `write` defaults to stderr.
 *
 * `exitCode` is set before `exit()` because stderr is synchronous for a pipe on Linux but not
 * always on Windows: even if the line above is truncated on the way out, the exit status is right.
 */
export function installFatalHandlers(
  target: FatalTarget,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): void {
  const handle = (kind: FatalKind) => (value: unknown) => {
    write(formatFatal(kind, value))
    target.exitCode = 1
    target.exit(1)
  }
  target.on('unhandledRejection', handle('unhandledRejection'))
  target.on('uncaughtException', handle('uncaughtException'))
}

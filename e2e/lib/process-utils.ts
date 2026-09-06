// Minimal, dependency-free process orchestration for `global-setup.ts`. Playwright's own `webServer`
// config option (used by `apps/web/test/e2e/playwright.config.ts`, EPIC-000.7's own minimum suite)
// starts and stops exactly one thing and aborts the whole run if it does not become healthy in time.
// This item needs graceful *partial* degradation instead -- `/login` and `/setup`'s pristine form
// render with nothing but `apps/web`'s dev server; every other route needs `apps/api` too, and
// `apps/api` needs Postgres/Valkey and applied migrations, none of which are guaranteed to exist yet
// (design.md's own work-breakdown makes `@devon/db`'s `migrate:apply` and the demo seed separate,
// later-landing work items). A hand-rolled child-process manager lets `global-setup.ts` try the full
// stack, log exactly what is missing, and let the tests that do not need it still run and pass.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { platform } from 'node:process'
import { REPO_ROOT } from './env.js'

const isWin = platform === 'win32'

/** Windows needs `shell: true` to resolve `.cmd`/`.ps1` shims (pnpm, docker CLI plugins); combining
 * that with a separate argv array makes Node warn (DEP0190) because the array is joined without
 * escaping, so on Windows this builds one already-quoted command string instead (same approach as
 * `scripts/start.mjs`, which this file deliberately mirrors rather than importing -- that script is
 * outside this item's TOUCHES). */
function quote(arg: string): string {
  return /[\s"&|<>^%]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

function spawnArgs(cmd: string, args: readonly string[]): [string, string[]] {
  return isWin ? [[cmd, ...args].map(quote).join(' '), []] : [cmd, [...args]]
}

export interface ManagedProcess {
  readonly label: string
  readonly child: ChildProcess
  readonly output: string[]
  stop(): Promise<void>
}

export interface SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Called for every stdout/stderr line, in addition to the internal ring buffer used by
   * `waitForOutput`. */
  onLine?: (line: string) => void
}

/** Spawns a long-running command (a dev server, typically) with piped output so callers can wait for
 * a line to appear (`waitForOutput`) before falling through to an HTTP readiness check. Never
 * inherits stdio -- a piped child is required to read its output at all, and a silent child on a CI
 * runner is worse than a slightly verbose one, so every line is also echoed with a `[label]` prefix. */
export function spawnManaged(
  label: string,
  cmd: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ManagedProcess {
  const [c, a] = spawnArgs(cmd, args)
  const child = spawn(c, a, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  const onData = (buf: Buffer): void => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line) continue
      output.push(line)
      if (output.length > 500) output.shift()
      console.log(`[${label}] ${line}`)
      options.onLine?.(line)
    }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)

  return {
    label,
    child,
    output,
    async stop() {
      if (child.exitCode !== null || child.killed) return
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        // On Windows, `child.kill()` for a `shell: true` process only terminates the `cmd.exe`
        // wrapper -- its grandchildren (`pnpm` -> `node`/`tsx` -> the real `vite`/Fastify listener)
        // are orphaned, `child`'s own `exit` fires immediately, and the port stays bound (verified
        // empirically while building this suite: every plain `child.kill()` here leaked a listener
        // into the next run). `taskkill /T` (kill the whole tree) is the only reliable option and is
        // used unconditionally, not as a delayed fallback.
        if (isWin && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
        else child.kill('SIGTERM')
        // Belt: force-kill anything still alive after a short grace period (POSIX SIGTERM ignored,
        // or `taskkill` racing a process that had not finished spawning its own children yet).
        setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            if (isWin && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
            else child.kill('SIGKILL')
          }
        }, 2000)
      })
    },
  }
}

/** Polls `url` with a plain `fetch` until it responds (any status -- callers that care about the
 * status code check it themselves once this resolves) or `timeoutMs` elapses. */
export async function waitForHttp(
  url: string,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      void res.body?.cancel()
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return false
}

/** Runs a short-lived command to completion and returns whether it exited 0, without throwing --
 * every caller in `global-setup.ts` treats a non-zero exit as "this optional step did not happen",
 * never as a hard failure of the whole suite (see this file's top comment). */
export function runToCompletion(
  label: string,
  cmd: string,
  args: readonly string[],
  options: SpawnOptions = {},
): { ok: boolean; output: string } {
  const [c, a] = spawnArgs(cmd, args)
  console.log(`[${label}] running: ${cmd} ${args.join(' ')}`)
  const result = spawnSync(c, a, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    shell: isWin,
    encoding: 'utf8',
    timeout: 180_000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  for (const line of output.split(/\r?\n/)) if (line) console.log(`[${label}] ${line}`)
  const ok = result.status === 0
  if (!ok)
    console.log(
      `[${label}] exited ${result.status ?? `signal ${result.signal}`} -- treating as skipped, not fatal`,
    )
  return { ok, output }
}

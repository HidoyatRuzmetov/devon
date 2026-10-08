// Minimal, self-contained process spawning for `global-setup.ts` -- deliberately not importing
// `e2e/lib/process-utils.ts` (the root `e2e/` package manages its own `node_modules` outside the pnpm
// workspace, per that directory's own `package.json` header, so a relative import from `apps/web`
// would not resolve its dependencies) or anything from `apps/api/src` (a different workspace package;
// importing its internals here would reach into another package's `node_modules` that pnpm's isolated
// layout does not guarantee is even present). Windows needs `shell: true` with one already-quoted
// command string, same as `scripts/start.mjs` -- see that file's own comment on `spawnArgs`.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const isWin = process.platform === 'win32'
const quote = (a: string) => (/[\s"&|<>^%]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)

export type ManagedProcess = {
  stop(): Promise<void>
  /** Every stdout/stderr line seen so far, in order -- used to find the one-time setup-URL line. */
  lines: string[]
}

export function spawnManaged(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; logFile?: string },
): ManagedProcess {
  const lines: string[] = []
  let child: ChildProcessWithoutNullStreams
  if (isWin) {
    const joined = [command, ...args].map(quote).join(' ')
    child = spawn(joined, [], {
      cwd: opts.cwd,
      env: opts.env,
      shell: true,
    }) as ChildProcessWithoutNullStreams
  } else {
    // Own a process group so pnpm -> tsx -> node is stopped together on Linux CI, too.
    child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
    }) as ChildProcessWithoutNullStreams
  }
  const capture = (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (line.length > 0) {
        lines.push(line)
        // `apps/api`'s own dev output, mirrored to a durable file -- a spawned dev server's stdout is
        // otherwise only ever seen live or (on failure) as the last few lines global-setup prints;
        // this is what H30.1 troubleshooting reads when a flow's server-side error needs its own
        // stack trace, not just the sanitised Problem body the client saw.
        if (opts.logFile) {
          try {
            appendFileSync(opts.logFile, line + '\n', 'utf8')
          } catch {
            // best-effort only
          }
        }
      }
    }
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  let stopPromise: Promise<void> | null = null

  async function stopTree(): Promise<void> {
    if (!isWin && child.pid) {
      const signalGroup = (signal: NodeJS.Signals | 0): boolean => {
        try {
          process.kill(-child.pid!, signal)
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
          throw error
        }
      }
      if (!signalGroup('SIGTERM')) return
      // The launcher can exit before the API releases its port and pool. Wait for the whole group,
      // with a bounded kill fallback for a child that cannot finish its shutdown.
      const deadline = Date.now() + 5000
      while (signalGroup(0)) {
        if (Date.now() >= deadline) {
          signalGroup('SIGKILL')
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return
    }
    if (child.exitCode !== null || child.killed) return
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(finish, 5000)
      child.once('exit', finish)
      // Windows requires taskkill /T to reach pnpm -> tsx -> node.
      if (child.pid) spawn(`taskkill /pid ${child.pid} /T /F`, [], { shell: true })
    })
  }

  return {
    lines,
    stop() {
      return (stopPromise ??= stopTree())
    },
  }
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

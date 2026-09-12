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
    child = spawn(joined, [], { cwd: opts.cwd, env: opts.env, shell: true }) as ChildProcessWithoutNullStreams
  } else {
    child = spawn(command, args, { cwd: opts.cwd, env: opts.env }) as ChildProcessWithoutNullStreams
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

  return {
    lines,
    async stop() {
      if (child.exitCode !== null || child.killed) return
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        // Windows has no SIGTERM semantics for a shell-spawned tree; taskkill /T reaches the whole
        // process tree (pnpm -> node), same problem `scripts/start.mjs`'s own SIGINT/SIGTERM forwarder
        // would otherwise leave orphaned on Windows.
        if (isWin && child.pid) {
          spawn(`taskkill /pid ${child.pid} /T /F`, [], { shell: true })
        } else {
          child.kill('SIGTERM')
        }
        setTimeout(() => resolve(), 5000)
      })
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

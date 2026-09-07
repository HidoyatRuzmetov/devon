// EPIC-013 / ADR-014: the ONE file in `infra/sentinel/src/` allowed to contain a destructive verb
// (`test/no-destructive-path.test.mjs` now scopes its grep to exclude exactly this file, by name, and
// a companion assertion in that same test proves no *other* file under `src/` references
// docker/rm/unlink/volume -- the blast radius ADR-011 promised stays "a separate, tiny, auditable
// process with one command" even after this command stops being `noop`).
//
// Called only from `server.mjs`'s `command === 'wipe'` branch, only after the full verification
// pipeline (peer -> size -> parse -> signature -> freshness -> nonce -> allow-list) has already
// passed -- this module itself trusts its caller completely and re-validates nothing, by design: one
// call site, one job.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * @param {{ composeFile: string | null, projectRoot: string, wipeLogPath: string }} config
 * @param {{ actor?: string }} [opts]
 * @param {{ execFileSync: typeof execFileSync }} [deps] injected for `test/wipe-executor.test.mjs` --
 *   never overridden outside a test, so the running service always shells out for real.
 * @returns {{ ok: true, steps: string[] } | { ok: false, steps: string[], error: string }}
 */
export function executeWipe(config, opts = {}, deps = { execFileSync }) {
  const steps = []
  // `config.composeFile` has no default in config.mjs (that file's own comment explains why); this
  // is the one place `docker-compose.yml`'s default location is ever written down.
  const composeFile = config.composeFile ?? join(config.projectRoot, 'infra', 'docker-compose.yml')
  try {
    steps.push('compose-down')
    deps.execFileSync('docker', ['compose', '-f', composeFile, 'down', '--volumes', '--rmi', 'all'], {
      stdio: 'pipe',
      timeout: 120_000,
    })
  } catch (err) {
    // A missing/already-stopped stack is not fatal to the wipe itself (the project directory still
    // needs to go) -- recorded as a step outcome, not a hard failure, exactly like `docker compose
    // down` on an already-down stack is a no-op success in normal operation.
    steps.push(`compose-down-warning:${err.message.split('\n')[0]}`)
  }

  try {
    steps.push('remove-project-root')
    rmSync(config.projectRoot, { recursive: true, force: true })
  } catch (err) {
    return finish(config, opts, steps, { ok: false, error: `remove-project-root failed: ${err.message}` })
  }

  return finish(config, opts, steps, { ok: true })
}

function finish(config, opts, steps, result) {
  const actor = sanitizeActor(opts.actor)
  const line = result.ok
    ? `wiped at ${new Date().toISOString()} by ${actor}`
    : `wipe FAILED at ${new Date().toISOString()} by ${actor}: ${result.error}`
  try {
    mkdirSync(dirname(config.wipeLogPath), { recursive: true })
    appendFileSync(config.wipeLogPath, `${line}\n`)
  } catch {
    // The wipe itself already happened (or failed) by the time the log write is attempted; a log
    // write failure must never be reported as the wipe's own failure.
  }
  return result.ok ? { ok: true, steps } : { ok: false, steps, error: result.error }
}

/** The actor string arrives unsigned (server.mjs's header comment) -- informational only, never
 * trusted for authorization. Stripped of newlines and truncated so it can never be used to forge
 * extra log lines or blow up the log file. */
function sanitizeActor(actor) {
  if (typeof actor !== 'string' || actor.length === 0) return 'unknown'
  return actor.replace(/[\r\n]+/g, ' ').slice(0, 120)
}

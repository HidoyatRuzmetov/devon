// Thin wrapper over `agentic/scripts/gate.mjs` (never reimplemented, never edited -- PROTOCOL §3):
// spawns it, then reads the `agentic/ledger/last-gate.json` it always writes, so a mutation module
// gets structured per-gate results instead of parsing console output.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} root repo root
 * @param {{ profile?: string, gates?: string[], timeoutMs?: number }} opts
 *   Exactly one of `profile` / `gates` should be given, mirroring gate.mjs's own CLI.
 * @returns {{ exitCode: number, stdout: string, stderr: string, report: object }}
 */
export function runGates(root, opts = {}) {
  const args = [join(root, 'agentic', 'scripts', 'gate.mjs')]
  if (opts.gates?.length) args.push('--gates', opts.gates.join(','))
  else args.push('--profile', opts.profile ?? 'integration')
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const reportPath = join(root, 'agentic', 'ledger', 'last-gate.json')
  let report = null
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (e) {
    report = { ok: false, results: [], error: `could not read ${reportPath}: ${String(e)}` }
  }
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', report }
}

/** Look up one gate's result row in a gate.mjs report, or null if it did not run. */
export function findResult(report, gateName) {
  return report.results?.find((r) => r.name === gateName) ?? null
}

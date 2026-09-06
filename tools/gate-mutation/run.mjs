#!/usr/bin/env node
// tools/gate-mutation -- the AC-14 non-vacuity harness (EPIC-000.10, ADR-013).
//
// For each blocking gate in `agentic/gates.json`'s `integration` profile, this tool applies exactly
// one deliberate, minimal, hand-picked defect of that gate's kind (see `mutations/<gate>.mjs`), runs
// `agentic/scripts/gate.mjs` (never a reimplementation of it -- PROTOCOL §3, gate.mjs is untouched by
// every module here), checks that the defect made the *right* gate fail and nothing else, and then
// reverts the defect byte-for-byte. It never edits `agentic/gates.json` or `agentic/scripts/gate.mjs`.
//
// Two modes:
//
//   --mode=profile   (default) Runs the full `agentic/scripts/gate.mjs --profile integration` before
//                     any mutation (the baseline) and again after each one, and compares every gate's
//                     status between the two runs. This is the literal handoff contract ("run
//                     gate.mjs --profile integration; assert only that gate fails") and the only mode
//                     that actually proves *isolation* -- that mutating gate X's target does not also
//                     move gate Y. It is expensive: each iteration re-runs typecheck/lint/unit/build
//                     across every package plus migrate (Testcontainers), e2e/a11y (a browser) and
//                     security (Semgrep/Trivy). Intended for CI and a fully-provisioned machine.
//
//   --mode=targeted  Applies the mutation, runs only that gate's own prerequisite gates (if any -- see
//                     `prereqGates` on a mutation module, e.g. `bundle` needs a fresh `build`) plus the
//                     target gate itself via `gate.mjs --gates <...>`, and asserts that one gate fails.
//                     Fast, useful for iterating on a mutation module locally, but does not prove
//                     isolation from the other ten gates the way `--mode=profile` does -- it is not a
//                     substitute for a `--mode=profile --all` run before this item is called done.
//
// Usage:
//   node tools/gate-mutation/run.mjs --list
//   node tools/gate-mutation/run.mjs --gate unit [--mode=targeted]
//   node tools/gate-mutation/run.mjs --all [--mode=targeted] [--json]
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { findResult, runGates } from './lib/run-gate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, def) => {
  const withEq = args.find((a) => a.startsWith(`${name}=`))
  if (withEq) return withEq.slice(name.length + 1)
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

async function loadMutations() {
  const dir = join(HERE, 'mutations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()
  const mods = []
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(dir, f)).href)).default
    if (!mod?.gate || typeof mod.apply !== 'function') {
      throw new Error(`gate-mutation: mutations/${f} does not export {gate, apply}`)
    }
    mods.push(mod)
  }
  return mods
}

function gitPorcelain(paths) {
  const r = spawnSync('git', ['status', '--porcelain', '--', ...paths], { cwd: ROOT, encoding: 'utf8' })
  return (r.stdout ?? '').trim()
}

/** Confirms a mutation module's revert left the tree exactly as it found it. */
function assertClean(mutation) {
  const dirty = gitPorcelain(mutation.targets ?? [])
  if (dirty) {
    throw new Error(
      `gate-mutation: revert for '${mutation.gate}' left uncommitted changes:\n${dirty}\n` +
        `This is a bug in mutations/${mutation.gate}.mjs, not evidence about the gate itself.`,
    )
  }
}

const BLOCKING_TOLERANT_STATUSES = new Set(['pass', 'skipped']) // skipped is only equal-to-baseline, never a pass by itself

function sameStatus(a, b) {
  if (!a || !b) return false
  return a.status === b.status
}

async function runProfileMode(mutation, baseline) {
  const revert = mutation.apply(ROOT)
  let mutated
  try {
    mutated = runGates(ROOT, { profile: 'integration' })
  } finally {
    revert()
    assertClean(mutation)
  }

  const baseTarget = findResult(baseline.report, mutation.gate)
  const mutTarget = findResult(mutated.report, mutation.gate)
  const targetFlipped = baseTarget?.status !== 'fail' && mutTarget?.status === 'fail'

  const collateral = []
  for (const r of mutated.report.results ?? []) {
    if (r.name === mutation.gate) continue
    const baseR = findResult(baseline.report, r.name)
    if (!sameStatus(baseR, r)) collateral.push({ gate: r.name, before: baseR?.status, after: r.status })
  }

  let status
  if (!targetFlipped) {
    status = mutation.knownGap ? 'confounded' : 'no-flip'
  } else if (collateral.length) {
    status = 'collateral'
  } else {
    status = 'confirmed'
  }

  return { mutation, mode: 'profile', status, baseTarget, mutTarget, collateral, mutated }
}

async function runTargetedMode(mutation) {
  // Baseline on the unmutated tree first, scoped to just this gate (cheap -- one gate, not the
  // whole profile) -- this is what lets the harness tell "the defect caused this failure" apart
  // from "this gate was already failing before I touched anything" (e.g. the a11y/e2e known gaps)
  // without having to hardcode which gates are confounded.
  if (mutation.prereqGates?.length) runGates(ROOT, { gates: mutation.prereqGates })
  const baseline = runGates(ROOT, { gates: [mutation.gate] })
  const baseR = findResult(baseline.report, mutation.gate)

  const revert = mutation.apply(ROOT)
  let result
  try {
    if (mutation.prereqGates?.length) runGates(ROOT, { gates: mutation.prereqGates })
    result = runGates(ROOT, { gates: [mutation.gate] })
  } finally {
    revert()
    assertClean(mutation)
  }

  const r = findResult(result.report, mutation.gate)
  const flipped = baseR?.status !== 'fail' && r?.status === 'fail'
  let status
  if (r?.status === 'skipped') status = 'tooling-unavailable'
  else if (flipped) status = 'confirmed'
  else if (r?.status === 'fail') status = 'confounded' // already failing before the mutation
  else status = 'no-flip'

  return { mutation, mode: 'targeted', status, baseTarget: baseR, mutTarget: r, collateral: [], result }
}

function printResult(res) {
  const { mutation, status } = res
  const label = { confirmed: 'PASS', confounded: 'CONFOUNDED', collateral: 'COLLATERAL', 'no-flip': 'FAIL', 'tooling-unavailable': 'SKIPPED' }[status]
  console.log(`\n=== ${mutation.gate} :: ${label} (${res.mode} mode) ===`)
  console.log(`defect: ${mutation.description}`)
  if (res.mutTarget) console.log(`gate result: ${res.mutTarget.status} (exit ${res.mutTarget.code ?? 'n/a'})`)
  if (res.mutTarget?.tail) console.log(`--- tail ---\n${res.mutTarget.tail}`)
  if (mutation.knownGap) console.log(`known gap: ${mutation.knownGap}`)
  if (res.collateral?.length) {
    console.log('collateral (other gates changed status too -- isolation NOT proven):')
    for (const c of res.collateral) console.log(`  - ${c.gate}: ${c.before} -> ${c.after}`)
  }
}

async function main() {
  const all = await loadMutations()

  if (flag('--list')) {
    for (const m of all) console.log(`${m.gate.padEnd(10)} ${m.description}`)
    return
  }

  const mode = opt('--mode', 'profile')
  if (!['profile', 'targeted'].includes(mode)) {
    console.error(`gate-mutation: unknown --mode "${mode}" (expected profile|targeted)`)
    process.exit(2)
  }

  let selected
  const gateArg = opt('--gate')
  if (gateArg) {
    selected = all.filter((m) => m.gate === gateArg)
    if (!selected.length) {
      console.error(`gate-mutation: no mutation module for gate "${gateArg}". --list to see available.`)
      process.exit(2)
    }
  } else if (flag('--all')) {
    selected = all
  } else {
    console.error('gate-mutation: pass --list, --gate <name>, or --all')
    process.exit(2)
  }

  let baseline = null
  if (mode === 'profile') {
    console.log('[gate-mutation] baseline: node agentic/scripts/gate.mjs --profile integration (unmutated tree)')
    baseline = runGates(ROOT, { profile: 'integration' })
    console.log(`[gate-mutation] baseline ok=${baseline.report.ok} failed=${JSON.stringify(baseline.report.failed)} skipped=${JSON.stringify(baseline.report.skipped)}`)
  }

  const results = []
  for (const mutation of selected) {
    console.log(`\n[gate-mutation] ${mutation.gate}: applying...`)
    const res = mode === 'profile' ? await runProfileMode(mutation, baseline) : await runTargetedMode(mutation)
    results.push(res)
    printResult(res)
  }

  if (flag('--json')) {
    console.log(
      JSON.stringify(
        results.map((r) => ({ gate: r.mutation.gate, status: r.status, mode: r.mode, collateral: r.collateral })),
        null,
        2,
      ),
    )
  }

  const bad = results.filter((r) => r.status === 'no-flip' || r.status === 'collateral')
  const confounded = results.filter((r) => r.status === 'confounded')
  const skipped = results.filter((r) => r.status === 'tooling-unavailable')
  console.log(
    `\n[gate-mutation] ${results.length} run, ${results.length - bad.length - confounded.length - skipped.length} confirmed, ` +
      `${confounded.length} confounded (pre-existing, documented gap), ${skipped.length} skipped (tooling unavailable), ${bad.length} FAILED`,
  )
  process.exit(bad.length ? 1 : 0)
}

main().catch((err) => {
  console.error('[gate-mutation] fatal:', err)
  process.exit(1)
})

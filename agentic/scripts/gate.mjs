#!/usr/bin/env node
// Deterministic gate runner. Usage:
//   node agentic/scripts/gate.mjs [--profile fast|item|integration|release] [--gates a,b,c] [--json] [--cwd <dir>]
// Exit 0 when every blocking gate passed, 1 otherwise. Always writes agentic/ledger/last-gate.json.
// Rules: gates are never weakened here. If package.json is missing at the root, every gate is SKIPPED
// loudly (pre-scaffold state). Once package.json exists, a missing script is a FAIL, not a skip.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const flag = (name) => args.includes(name)
const cwd = resolve(opt('--cwd', process.cwd()))
const cfgPath = join(cwd, 'agentic', 'gates.json')
if (!existsSync(cfgPath)) { console.error(`gate: no ${cfgPath}`); process.exit(1) }
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
const profile = opt('--profile', 'fast')
const names = opt('--gates') ? opt('--gates').split(',').map(s => s.trim()).filter(Boolean) : (cfg.profiles[profile] || [])
if (!names.length) { console.error(`gate: unknown profile "${profile}" and no --gates`); process.exit(1) }
const scaffolded = existsSync(join(cwd, 'package.json'))
const isRelease = profile === 'release'

function run(cmd, timeoutS) {
  return new Promise((res) => {
    const started = Date.now()
    const child = spawn(cmd, { cwd, shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } })
    let out = ''
    const push = (b) => { out += b.toString(); if (out.length > 200000) out = out.slice(-200000) }
    child.stdout.on('data', push); child.stderr.on('data', push)
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; out += `\n[gate] TIMEOUT after ${timeoutS}s` }, timeoutS * 1000)
    child.on('close', (code) => { clearTimeout(timer); res({ code, out, ms: Date.now() - started }) })
    child.on('error', (e) => { clearTimeout(timer); res({ code: 127, out: out + '\n' + String(e), ms: Date.now() - started }) })
  })
}

const tail = (s, n = 60) => s.trim().split(/\r?\n/).slice(-n).join('\n')
const results = []
const startedAt = new Date().toISOString()
for (const name of names) {
  const g = cfg.gates[name]
  if (!g) { results.push({ name, status: 'fail', blocking: true, ms: 0, tail: `unknown gate "${name}" in gates.json` }); continue }
  const blocking = !!g.blocking || (isRelease && !!g.blocking_on_release)
  if (!scaffolded) { results.push({ name, status: 'skipped', blocking, ms: 0, tail: 'SKIPPED: no package.json at root (pre-scaffold). This is NOT a pass.' }); continue }
  process.stdout.write(`[gate] ${name} … `)
  const r = await run(g.cmd, g.timeout_s || 600)
  const status = r.code === 0 ? 'pass' : 'fail'
  console.log(`${status.toUpperCase()} (${(r.ms / 1000).toFixed(1)}s)`)
  results.push({ name, status, blocking, ms: r.ms, code: r.code, cmd: g.cmd, tail: status === 'pass' ? tail(r.out, 5) : tail(r.out, 80) })
}
const failed = results.filter(r => r.status === 'fail' && r.blocking)
const skipped = results.filter(r => r.status === 'skipped')
const ok = failed.length === 0 && (skipped.length === 0 || !scaffolded)
const report = { profile, cwd, startedAt, finishedAt: new Date().toISOString(), scaffolded, ok, failed: failed.map(f => f.name), skipped: skipped.map(s => s.name), results }
mkdirSync(join(cwd, 'agentic', 'ledger'), { recursive: true })
writeFileSync(join(cwd, 'agentic', 'ledger', 'last-gate.json'), JSON.stringify(report, null, 2))
if (flag('--json')) console.log(JSON.stringify(report, null, 2))
else {
  for (const r of results) if (r.status !== 'pass') console.log(`\n--- ${r.name} (${r.status}${r.blocking ? ', blocking' : ''}) ---\n${r.tail}`)
  console.log(`\n[gate] profile=${profile} ok=${ok} failed=[${failed.map(f => f.name).join(', ')}] skipped=[${skipped.map(s => s.name).join(', ')}]`)
  if (skipped.length) console.log('[gate] WARNING: skipped gates are not passes. Do not report "gates green" while anything is skipped.')
}
process.exit(ok ? 0 : 1)

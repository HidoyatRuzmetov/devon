#!/usr/bin/env node
// Deterministic gate runner. Usage:
//   node agentic/scripts/gate.mjs [--profile fast|item|integration|release] [--gates a,b,c] [--json] [--cwd <dir>]
// Exit 0 when every blocking gate passed (per the profile's tolerance for skipped gates), 1 otherwise.
// Always writes agentic/ledger/last-gate.json.
//
// Skips are explicit and loud, never silent:
//   - no package.json at the root            → every gate SKIPPED (pre-scaffold)
//   - gate.requires: [paths] missing          → SKIPPED (the part of the repo it checks does not exist yet)
//   - gate.requires_cmd: [binaries] missing   → SKIPPED (tooling not installed on this machine)
// Tolerance by profile: fast/item accept skipped gates; integration accepts skipped only for gates
// marked optional_local (tooling gates such as security/perf); release accepts none.
import { spawn, spawnSync } from 'node:child_process'
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

const hasCmd = (bin) => { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return r.status === 0 }
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
const logDir = join(cwd, 'agentic', 'ledger', 'gate-logs')
mkdirSync(logDir, { recursive: true })
for (const name of names) {
  const g = cfg.gates[name]
  if (!g) { results.push({ name, status: 'fail', blocking: true, tolerated: false, ms: 0, tail: `unknown gate "${name}" in gates.json` }); continue }
  const blocking = !!g.blocking || (isRelease && !!g.blocking_on_release)
  const tolerated = profile === 'fast' || profile === 'item' || (profile === 'integration' && !!g.optional_local)
  let skipReason = null
  if (!scaffolded) skipReason = 'no package.json at root (pre-scaffold)'
  else if (Array.isArray(g.requires) && g.requires.some(p => !existsSync(join(cwd, p)))) skipReason = `required path missing: ${g.requires.filter(p => !existsSync(join(cwd, p))).join(', ')}`
  else if (Array.isArray(g.requires_cmd) && g.requires_cmd.some(b => !hasCmd(b))) skipReason = `required tool not installed: ${g.requires_cmd.filter(b => !hasCmd(b)).join(', ')}`
  if (skipReason) { results.push({ name, status: 'skipped', blocking, tolerated, ms: 0, tail: `SKIPPED: ${skipReason}. A skipped gate is NOT a pass.` }); continue }
  process.stdout.write(`[gate] ${name} … `)
  const r = await run(g.cmd, g.timeout_s || 600)
  // Keep the bounded diagnostic buffer: a long exception can otherwise hide its cause above the
  // short console tail. CI uploads this alongside the summary, including when later gates fail.
  writeFileSync(join(logDir, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`), r.out)
  const status = r.code === 0 ? 'pass' : 'fail'
  console.log(`${status.toUpperCase()} (${(r.ms / 1000).toFixed(1)}s)`)
  results.push({ name, status, blocking, tolerated, ms: r.ms, code: r.code, cmd: g.cmd, tail: status === 'pass' ? tail(r.out, 5) : tail(r.out, 80) })
}
const failed = results.filter(r => r.status === 'fail' && r.blocking)
const skipped = results.filter(r => r.status === 'skipped')
const untolerated = skipped.filter(r => r.blocking && !r.tolerated)
const ok = failed.length === 0 && untolerated.length === 0
const report = { profile, cwd, startedAt, finishedAt: new Date().toISOString(), scaffolded, ok, failed: failed.map(f => f.name), skipped: skipped.map(s => s.name), skipped_blocking: untolerated.map(s => s.name), results }
mkdirSync(join(cwd, 'agentic', 'ledger'), { recursive: true })
writeFileSync(join(cwd, 'agentic', 'ledger', 'last-gate.json'), JSON.stringify(report, null, 2))
if (flag('--json')) console.log(JSON.stringify(report, null, 2))
else {
  for (const r of results) if (r.status !== 'pass') console.log(`\n--- ${r.name} (${r.status}${r.blocking ? ', blocking' : ''}${r.status === 'skipped' ? (r.tolerated ? ', tolerated in this profile' : ', NOT tolerated in this profile') : ''}) ---\n${r.tail}`)
  console.log(`\n[gate] profile=${profile} ok=${ok} failed=[${failed.map(f => f.name).join(', ')}] skipped=[${skipped.map(s => s.name).join(', ')}]${untolerated.length ? ` skipped-but-required=[${untolerated.map(s => s.name).join(', ')}]` : ''}`)
  if (skipped.length) console.log('[gate] WARNING: skipped gates are not passes. Release requires every gate to run.')
}
process.exit(ok ? 0 : 1)

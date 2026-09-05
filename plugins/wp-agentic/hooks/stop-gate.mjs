#!/usr/bin/env node
// Stop / SubagentStop hook (PROTOCOL §8). If code changed in this checkout and the fast gates fail, the
// agent is told to keep going instead of reporting "done". Bounded: at most 2 consecutive blocks per
// session (counter in the OS temp dir), then it lets the agent stop so it can report the failure honestly.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { readInput, projectRoot } from './_io.mjs'

const input = await readInput()

// Plugin copy: if the project wires its own agentic/hooks in .claude/settings.json, defer to them.
{ const __r = projectRoot(input); try { const __s = readFileSync(join(__r, '.claude', 'settings.json'), 'utf8'); if (__s.includes('agentic/hooks/')) process.exit(0) } catch {} }
const root = projectRoot(input)
const sid = String(input.session_id || 'nosession').replace(/[^a-z0-9-]/gi, '')
const counterFile = join(tmpdir(), `wp-stopgate-${sid}.json`)
const readCount = () => { try { return JSON.parse(readFileSync(counterFile, 'utf8')).n || 0 } catch { return 0 } }
const writeCount = (n) => { try { writeFileSync(counterFile, JSON.stringify({ n, ts: Date.now() })) } catch {} }
const allow = () => { writeCount(0); process.exit(0) }

if (!existsSync(join(root, 'package.json'))) allow()               // pre-scaffold: nothing to gate
if (input.stop_hook_active && readCount() >= 2) allow()             // bounded: never loop forever

let status = ''
try { status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { allow() }
const codeChanged = status.split(/\r?\n/).some(l => { const f = l.slice(3).trim().replace(/\\/g, '/'); return f && !/^(docs|agentic|\.claude)\//.test(f) && /\.(ts|tsx|js|jsx|mjs|cjs|sql|json|css|yml|yaml)$/.test(f) })
if (!codeChanged) allow()

const r = spawnSync(process.execPath, [join(root, 'agentic', 'scripts', 'gate.mjs'), '--profile', 'fast', '--json'], { cwd: root, encoding: 'utf8', timeout: 14 * 60 * 1000 })
let report = null
try { report = JSON.parse(readFileSync(join(root, 'agentic', 'ledger', 'last-gate.json'), 'utf8')) } catch {}
if (r.status === 0 && report && report.ok) allow()

const n = readCount() + 1
writeCount(n)
const failed = report ? report.results.filter(x => x.status !== 'pass' && x.blocking) : []
const detail = failed.map(f => `--- ${f.name} (${f.status}) ---\n${(f.tail || '').split('\n').slice(-25).join('\n')}`).join('\n')
const reason = `stop-gate: fast gates are RED (${failed.map(f => f.name).join(', ') || 'unknown'}). Attempt ${n}/2. ` +
  `If you are a maker/fixer: fix the failures now (do not edit tests or gates), re-run \`node agentic/scripts/gate.mjs --profile fast\`, then finish. ` +
  `If you are a verifier and cannot edit: finish your report and state that gates are red.\n${detail}`
console.log(JSON.stringify({ decision: 'block', reason }))
process.exit(0)

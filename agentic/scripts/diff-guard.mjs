#!/usr/bin/env node
// Deterministic scope guard for makers and the fixer.
//   node agentic/scripts/diff-guard.mjs --since <git ref> [--touches "glob1,glob2"] [--forbid fixer] [--revert] [--json]
// Lists files changed since <ref> (tracked + untracked). Violations are files outside --touches or matching
// the fixer_forbidden_globs from gates.json when --forbid fixer is given. Exit 1 on violations.
// --revert restores tracked violating files to <ref> and deletes untracked ones (used by workflows to
// undo out-of-scope edits before re-running gates). Protected paths from gates.json are always forbidden.
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const flag = (n) => args.includes(n)
const root = process.cwd()
const cfg = JSON.parse(readFileSync(join(root, 'agentic', 'gates.json'), 'utf8'))
const since = opt('--since', 'HEAD')
const sh = (c) => { try { return execSync(c, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }

const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : m === '*' ? '[^/]*' : '.') + '$')
const matchAny = (f, globs) => globs.some(g => g.endsWith('/') ? f.startsWith(g) : globToRe(g).test(f))

const changed = new Set()
for (const l of sh(`git diff --name-only ${since}`).split(/\r?\n/)) if (l.trim()) changed.add(l.trim().replace(/\\/g, '/'))
for (const l of sh('git ls-files --others --exclude-standard').split(/\r?\n/)) if (l.trim()) changed.add(l.trim().replace(/\\/g, '/'))
const files = [...changed].filter(f => !f.startsWith('agentic/ledger/'))

const touches = opt('--touches') ? opt('--touches').split(',').map(s => s.trim()).filter(Boolean) : null
const forbid = opt('--forbid') === 'fixer' ? (cfg.fixer_forbidden_globs || []) : []
const protectedPaths = cfg.protected_paths || []

const violations = []
for (const f of files) {
  if (matchAny(f, protectedPaths)) { violations.push({ file: f, why: 'protected path' }); continue }
  if (forbid.length && matchAny(f, forbid)) { violations.push({ file: f, why: 'forbidden for fixer (tests/migrations)' }); continue }
  if (touches && !matchAny(f, touches)) violations.push({ file: f, why: 'outside TOUCHES' })
}

if (flag('--revert') && violations.length) {
  const tracked = new Set(sh('git ls-files').split(/\r?\n/).map(s => s.trim().replace(/\\/g, '/')))
  for (const v of violations) {
    if (tracked.has(v.file)) { sh(`git checkout ${since} -- "${v.file}"`); v.action = 'restored' }
    else { try { unlinkSync(join(root, v.file)); v.action = 'deleted' } catch { v.action = 'delete-failed' } }
  }
}

const out = { since, changed: files, violations, ok: violations.length === 0 }
if (flag('--json')) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`[diff-guard] ${files.length} changed file(s) since ${since}`)
  for (const v of violations) console.log(`  VIOLATION ${v.file} — ${v.why}${v.action ? ` → ${v.action}` : ''}`)
  console.log(`[diff-guard] ok=${out.ok}`)
}
process.exit(out.ok ? 0 : 1)

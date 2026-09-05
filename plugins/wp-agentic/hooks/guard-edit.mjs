#!/usr/bin/env node
// PreToolUse guard for Edit/Write/MultiEdit/NotebookEdit (PROTOCOL §8).
// Blocks: protected paths (gates, invariants, protocol, hooks, settings), edits outside the repo (except
// OS temp and ~/.claude), edits to already-applied (git-tracked) migrations, and for WP_ROLE=wp-fixer any
// test/spec/e2e/migration file. Human override: create the empty file agentic/.unlock (remove it to re-arm).
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { readInput, projectRoot, loadGates, rel, matchAny, isTracked, block, allow } from './_io.mjs'

const input = await readInput()

// Plugin copy: if the project wires its own agentic/hooks in .claude/settings.json, defer to them.
{ const __r = projectRoot(input); try { const __s = readFileSync(join(__r, '.claude', 'settings.json'), 'utf8'); if (__s.includes('agentic/hooks/')) process.exit(0) } catch {} }
const ti = input.tool_input || {}
const target = ti.file_path || ti.notebook_path || ti.path
if (!target) allow()
const root = projectRoot(input)
const abs = resolve(root, target)
const norm = (p) => p.replace(/\\/g, '/').toLowerCase()
const inside = norm(abs).startsWith(norm(root) + '/') || norm(abs) === norm(root)
const inTemp = norm(abs).startsWith(norm(tmpdir())) || norm(abs).includes('/appdata/local/temp/')
const inClaudeHome = norm(abs).startsWith(norm(join(homedir(), '.claude')))
if (!inside && !inTemp && !inClaudeHome) block(`guard-edit: refusing to write outside the repository: ${abs}`)
if (!inside) allow()

const gates = loadGates(root)
if (!gates) allow()
if (existsSync(join(root, 'agentic', '.unlock'))) allow()

const r = rel(root, abs)
if (matchAny(r, gates.protected_paths)) block(`guard-edit: "${r}" is a protected path (PROTOCOL §3/§8). Agents may not edit gates, invariants, protocol, hooks or settings. If the rule is wrong, write an escalation in docs/04-escalations/ and continue with other work.`)

if (/^packages\/db\/migrations\/.+\.(sql|ts|js)$/.test(r) && isTracked(root, r)) block(`guard-edit: "${r}" is an applied migration (tracked in git). Migrations are never edited after being applied (INVARIANT I-15). Create a new migration instead.`)

if ((process.env.WP_ROLE || '').toLowerCase() === 'wp-fixer' && matchAny(r, gates.fixer_forbidden_globs)) block(`guard-edit: wp-fixer may not edit "${r}" (tests, specs, e2e, migrations). Fix the code, not the test. If the test is genuinely wrong, report it as a finding for wp-reviewer.`)

allow()

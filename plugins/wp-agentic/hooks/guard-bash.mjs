#!/usr/bin/env node
// PreToolUse guard for Bash (PROTOCOL §8). Refuses destructive or history-rewriting commands with a reason.
// It does not ask; it allows or refuses. Human override: agentic/.unlock present.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readInput, projectRoot, block, allow } from './_io.mjs'

const input = await readInput()

// Plugin copy: if the project wires its own agentic/hooks in .claude/settings.json, defer to them.
{ const __r = projectRoot(input); try { const __s = readFileSync(join(__r, '.claude', 'settings.json'), 'utf8'); if (__s.includes('agentic/hooks/')) process.exit(0) } catch {} }
const cmd = String((input.tool_input || {}).command || '')
if (!cmd) allow()
const root = projectRoot(input)
if (existsSync(join(root, 'agentic', '.unlock'))) allow()

const rules = [
  [/\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/, 'force-push is forbidden; rewrite history only with a human at the keyboard'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard discards work; use diff-guard --revert for scoped reverts'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'whole-tree discard is forbidden'],
  [/\bgit\s+clean\s+-[a-z]*f/, 'git clean -f deletes untracked work'],
  [/\bgit\s+commit\b[^\n]*--no-verify/, 'commits must run hooks'],
  [/\bgit\s+branch\s+-D\b/, 'force-deleting branches is forbidden'],
  [/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(?!.*(node_modules|\/dist\b|\.turbo|coverage|playwright-report|test-results|\.next|\.output|\btmp\b|\/temp\/|scratchpad))/i, 'rm -rf outside build artefacts/temp is forbidden'],
  [/\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b/i, 'destructive SQL is forbidden from agents'],
  [/\b(prisma\s+migrate\s+reset|drizzle-kit\s+drop|db:reset|db:drop)\b/i, 'database reset/drop is forbidden; use a fresh test database instead'],
  [/\bdocker\s+(compose\s+down\s+[^\n]*-v|volume\s+(rm|prune))/i, 'removing Docker volumes destroys data'],
  [/(^|[\s;&|])(>|>>|tee)\s*("|')?\.?\/?(\.env)(\.local|\.production)?("|')?(\s|$)/, 'writing .env files is forbidden; edit .env.example and document the variable'],
  [/\bcurl\b[^\n]*\|\s*(sh|bash|zsh)\b/, 'piping downloads into a shell is forbidden (supply chain)'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, 'publishing packages is a human action'],
  [/\bchmod\s+(-R\s+)?777\b/, 'world-writable permissions are forbidden'],
  [/\bkill\s+-9\s+-1\b|\bshutdown\b|\breboot\b/, 'system-level actions are forbidden'],
]
for (const [re, why] of rules) if (re.test(cmd)) block(`guard-bash: refused — ${why}.\nCommand: ${cmd.slice(0, 200)}`)
allow()

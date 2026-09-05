#!/usr/bin/env node
// Vendors the delivery-system runtime into the current project so the repo is self-contained:
//   node "<plugin-root>/scripts/init-project.mjs" [--force]
// Copies scaffold/agentic → ./agentic (PROTOCOL, ROSTER, INVARIANTS, gates.json, templates, README),
// scripts → ./agentic/scripts, hooks → ./agentic/hooks, creates docs/03-plan/backlog.json (+schema),
// docs/04-escalations, docs/adr, agentic/ledger, and appends .gitignore lines. Never overwrites an
// existing file unless --force. Prints what it did and the next steps.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')
const project = process.cwd()
const force = process.argv.includes('--force')
const did = []; const skipped = []

function copyTree(src, dst) {
  if (!existsSync(src)) return
  for (const e of readdirSync(src)) {
    const s = join(src, e), d = join(dst, e)
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d); continue }
    if (existsSync(d) && !force) { skipped.push(d.replace(project, '.')); continue }
    mkdirSync(dirname(d), { recursive: true }); cpSync(s, d); did.push(d.replace(project, '.'))
  }
}

copyTree(join(pluginRoot, 'scaffold', 'agentic'), join(project, 'agentic'))
copyTree(join(pluginRoot, 'scripts'), join(project, 'agentic', 'scripts'))
copyTree(join(pluginRoot, 'hooks'), join(project, 'agentic', 'hooks'))
mkdirSync(join(project, 'agentic', 'ledger'), { recursive: true })
for (const d of ['docs/03-plan', 'docs/04-escalations', 'docs/adr']) mkdirSync(join(project, d), { recursive: true })
const backlog = join(project, 'docs', '03-plan', 'backlog.json')
if (!existsSync(backlog)) { writeFileSync(backlog, JSON.stringify({ version: 1, note: 'Only `ready` epics run. Use node agentic/scripts/backlog.mjs add/validate.', epics: [] }, null, 2) + '\n'); did.push('./docs/03-plan/backlog.json') }
const schemaSrc = join(pluginRoot, 'scaffold', 'backlog.schema.json'); const schemaDst = join(project, 'docs', '03-plan', 'backlog.schema.json')
if (existsSync(schemaSrc) && (!existsSync(schemaDst) || force)) { cpSync(schemaSrc, schemaDst); did.push('./docs/03-plan/backlog.schema.json') }
const gi = join(project, '.gitignore'); const lines = ['agentic/ledger/last-gate.json', 'agentic/.unlock']
let giText = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
const add = lines.filter(l => !giText.split(/\r?\n/).includes(l))
if (add.length) { appendFileSync(gi, (giText.endsWith('\n') || !giText ? '' : '\n') + add.join('\n') + '\n'); did.push('./.gitignore (+' + add.length + ' lines)') }

// project-local settings: permissions + hooks pointing at the vendored copies (plugin hooks defer to these)
const settingsPath = join(project, '.claude', 'settings.json')
if (!existsSync(settingsPath) || force) {
  mkdirSync(dirname(settingsPath), { recursive: true })
  const settings = {
    permissions: { allow: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(pnpm *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(node *)', 'Bash(git *)', 'Bash(docker compose *)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)', 'Bash(wc *)', 'Bash(grep *)', 'Bash(rg *)', 'Bash(find *)', 'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)', 'Bash(echo *)', 'Bash(diff *)', 'Bash(curl *)', 'Bash(cd *)'], deny: ['Bash(git push --force*)', 'Bash(git push -f *)', 'Read(./.env)', 'Read(./.env.*)', 'Read(**/.env)', 'Write(./.env)', 'Edit(./.env)'] },
    hooks: {
      PreToolUse: [
        { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'node agentic/hooks/guard-edit.mjs', timeout: 15 }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node agentic/hooks/guard-bash.mjs', timeout: 15 }] },
      ],
      PostToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node agentic/hooks/post-edit-format.mjs', timeout: 30 }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node agentic/hooks/stop-gate.mjs', timeout: 900 }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: 'node agentic/hooks/stop-gate.mjs', timeout: 900 }] }],
    },
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n'); did.push('./.claude/settings.json')
} else skipped.push('./.claude/settings.json')

console.log(`wp-agentic init: project=${project}\n  plugin=${pluginRoot}`)
for (const d of did) console.log(`  + ${d}`)
if (skipped.length) console.log(`  (kept ${skipped.length} existing file(s); use --force to overwrite)`)
console.log(`\nNext:\n  1. Edit agentic/gates.json commands for this repo's package scripts.\n  2. Edit agentic/INVARIANTS.md for this product.\n  3. Add epics: node agentic/scripts/backlog.mjs add '{"title":"…","phase":1,"outcomes":["…"],"status":"ready","priority":10}'\n  4. node agentic/scripts/selftest.mjs\n  5. Run /wp-agentic:ship`)

#!/usr/bin/env node
// Backlog tool over docs/03-plan/backlog.json (the ONLY place scope enters the system).
//   node agentic/scripts/backlog.mjs list [--status ready|proposed|in-progress|done|blocked|draft|all]
//   node agentic/scripts/backlog.mjs next --json        # highest-priority `ready` epic whose deps are done
//   node agentic/scripts/backlog.mjs get EPIC-012 --json
//   node agentic/scripts/backlog.mjs set-status EPIC-012 in-progress [--note "..."]
//   node agentic/scripts/backlog.mjs add '<json epic>'  # status defaults to proposed; id auto-assigned if missing
//   node agentic/scripts/backlog.mjs validate
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.WP_ROOT || process.cwd()
const file = join(root, 'docs', '03-plan', 'backlog.json')
const STATUSES = ['draft', 'proposed', 'ready', 'in-progress', 'done', 'blocked', 'dropped']
const load = () => { if (!existsSync(file)) return { version: 1, epics: [] }; return JSON.parse(readFileSync(file, 'utf8')) }
const save = (b) => writeFileSync(file, JSON.stringify(b, null, 2) + '\n')
const args = process.argv.slice(2)
const [cmd, ...rest] = args
const opt = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d }
const json = args.includes('--json')

function validate(b) {
  const errs = []; const ids = new Set()
  for (const e of b.epics) {
    if (!e.id || !/^EPIC-\d{3}[a-z]?$/.test(e.id)) errs.push(`bad id: ${JSON.stringify(e.id)}`)
    if (ids.has(e.id)) errs.push(`duplicate id ${e.id}`); ids.add(e.id)
    if (!e.title) errs.push(`${e.id}: missing title`)
    if (!STATUSES.includes(e.status)) errs.push(`${e.id}: bad status ${e.status}`)
    if (typeof e.priority !== 'number') errs.push(`${e.id}: priority must be a number (lower = sooner)`)
    if (!Array.isArray(e.depends_on)) errs.push(`${e.id}: depends_on must be an array`)
    if (!e.phase) errs.push(`${e.id}: missing phase (1|2|3)`)
    if (e.status === 'ready' && !(Array.isArray(e.outcomes) && e.outcomes.length)) errs.push(`${e.id}: a ready epic needs outcomes[] (what the user can do afterwards)`)
  }
  for (const e of b.epics) for (const d of e.depends_on || []) if (!ids.has(d)) errs.push(`${e.id}: unknown dependency ${d}`)
  return errs
}

const b = load()
switch (cmd) {
  case 'list': {
    const st = opt('--status', 'all')
    const rows = b.epics.filter(e => st === 'all' || e.status === st).sort((a, c) => a.priority - c.priority)
    if (json) console.log(JSON.stringify(rows, null, 2)); else for (const e of rows) console.log(`${e.id}  [${e.status}]  p${e.priority}  ph${e.phase}  ${e.title}${e.depends_on?.length ? `  (after ${e.depends_on.join(', ')})` : ''}`)
    break
  }
  case 'next': {
    const done = new Set(b.epics.filter(e => e.status === 'done').map(e => e.id))
    const ready = b.epics.filter(e => e.status === 'ready' && (e.depends_on || []).every(d => done.has(d))).sort((a, c) => a.priority - c.priority)
    const blockedByDeps = b.epics.filter(e => e.status === 'ready' && !(e.depends_on || []).every(d => done.has(d))).map(e => e.id)
    const out = { epic: ready[0] || null, waiting_on_deps: blockedByDeps, in_progress: b.epics.filter(e => e.status === 'in-progress').map(e => e.id) }
    console.log(json ? JSON.stringify(out, null, 2) : (out.epic ? `${out.epic.id}  ${out.epic.title}` : 'none')); break
  }
  case 'get': {
    const e = b.epics.find(x => x.id === rest[0]); if (!e) { console.error(`no epic ${rest[0]}`); process.exit(1) }
    console.log(JSON.stringify(e, null, 2)); break
  }
  case 'set-status': {
    const [id, status] = rest; const e = b.epics.find(x => x.id === id)
    if (!e) { console.error(`no epic ${id}`); process.exit(1) }
    if (!STATUSES.includes(status)) { console.error(`status must be one of ${STATUSES.join('|')}`); process.exit(1) }
    e.history = e.history || []; e.history.push({ from: e.status, to: status, ts: new Date().toISOString(), note: opt('--note', '') })
    e.status = status; save(b); console.log(JSON.stringify({ ok: true, id, status })); break
  }
  case 'add': {
    const e = JSON.parse(rest[0]); e.status = e.status || 'proposed'; e.depends_on = e.depends_on || []; e.priority = e.priority ?? 500; e.phase = e.phase || 2
    if (!e.id) { const n = Math.max(0, ...b.epics.map(x => Number((x.id || '').replace(/\D/g, '')) || 0)) + 1; e.id = `EPIC-${String(n).padStart(3, '0')}` }
    e.created = new Date().toISOString(); b.epics.push(e)
    const errs = validate(b); if (errs.length) { console.error(errs.join('\n')); process.exit(1) }
    save(b); console.log(JSON.stringify({ ok: true, id: e.id })); break
  }
  case 'validate': { const errs = validate(b); if (errs.length) { console.error(errs.join('\n')); process.exit(1) } console.log(`backlog ok: ${b.epics.length} epics`); break }
  default: console.error('usage: backlog.mjs list|next|get|set-status|add|validate'); process.exit(1)
}

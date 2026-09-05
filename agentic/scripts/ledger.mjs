#!/usr/bin/env node
// Cycle and findings ledger. JSONL, append-only.
//   node agentic/scripts/ledger.mjs append cycles '<json>'
//   node agentic/scripts/ledger.mjs append findings '<json>'          # {epic,item,sev,path,summary,repro,evidence,status}
//   node agentic/scripts/ledger.mjs fingerprint "<path>" "<summary>"  # prints 8-char fingerprint
//   node agentic/scripts/ledger.mjs query findings --epic E --status open|closed|all
//   node agentic/scripts/ledger.mjs closed E                          # closed fingerprints for epic E (one per line)
//   node agentic/scripts/ledger.mjs close <fingerprint> <WONTFIX-BY-DECISION|ACCEPTED-DEBT|FIXED> "<reason>"
//   node agentic/scripts/ledger.mjs recent <area> [n]                 # last n cycles touching area
//   node agentic/scripts/ledger.mjs summary                           # markdown summary of all cycles
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.env.WP_ROOT || process.cwd()
const dir = join(root, 'agentic', 'ledger')
mkdirSync(dir, { recursive: true })
const file = (kind) => join(dir, `${kind}.jsonl`)
const readAll = (kind) => existsSync(file(kind)) ? readFileSync(file(kind), 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, ' ').trim().replace(/\s+/g, ' ')
const fingerprint = (path, summary) => createHash('sha1').update(`${String(path || '').replace(/\\/g, '/').replace(/:\d+$/, '')}|${norm(summary)}`).digest('hex').slice(0, 8)

const [cmd, ...rest] = process.argv.slice(2)
const opt = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : def }

switch (cmd) {
  case 'append': {
    const [kind, json] = rest
    if (!['cycles', 'findings', 'escalations'].includes(kind)) { console.error('kind must be cycles|findings|escalations'); process.exit(1) }
    const obj = JSON.parse(json)
    obj.ts = obj.ts || new Date().toISOString()
    if (kind === 'findings') { obj.fingerprint = obj.fingerprint || fingerprint(obj.path, obj.summary); obj.status = obj.status || 'open' }
    appendFileSync(file(kind), JSON.stringify(obj) + '\n')
    console.log(JSON.stringify({ ok: true, fingerprint: obj.fingerprint }))
    break
  }
  case 'fingerprint': { console.log(fingerprint(rest[0], rest[1])); break }
  case 'query': {
    const kind = rest[0]; const epic = opt('--epic'); const status = opt('--status', 'all')
    let rows = readAll(kind)
    if (epic) rows = rows.filter(r => r.epic === epic)
    if (kind === 'findings') {
      // latest status per fingerprint wins
      const latest = new Map(); for (const r of rows) latest.set(r.fingerprint, { ...(latest.get(r.fingerprint) || {}), ...r })
      rows = [...latest.values()]
      if (status !== 'all') rows = rows.filter(r => (status === 'open' ? r.status === 'open' : r.status !== 'open'))
    }
    console.log(JSON.stringify(rows, null, 2)); break
  }
  case 'closed': {
    const epic = rest[0]; const latest = new Map()
    for (const r of readAll('findings')) if (!epic || r.epic === epic) latest.set(r.fingerprint, r)
    for (const r of latest.values()) if (r.status && r.status !== 'open') console.log(r.fingerprint)
    break
  }
  case 'close': {
    const [fp, status, reason] = rest
    if (!['WONTFIX-BY-DECISION', 'ACCEPTED-DEBT', 'FIXED'].includes(status)) { console.error('status must be WONTFIX-BY-DECISION|ACCEPTED-DEBT|FIXED'); process.exit(1) }
    const prev = readAll('findings').filter(r => r.fingerprint === fp).pop()
    if (!prev) { console.error(`no finding with fingerprint ${fp}`); process.exit(1) }
    appendFileSync(file('findings'), JSON.stringify({ ...prev, status, reason: reason || '', ts: new Date().toISOString() }) + '\n')
    console.log(JSON.stringify({ ok: true, fingerprint: fp, status })); break
  }
  case 'recent': {
    const area = rest[0]; const n = Number(rest[1] || 5)
    const rows = readAll('cycles').filter(c => !area || (c.area === area) || (Array.isArray(c.areas) && c.areas.includes(area)) || String(c.epic || '').includes(area))
    console.log(JSON.stringify(rows.slice(-n), null, 2)); break
  }
  case 'summary': {
    const cycles = readAll('cycles'); const findings = readAll('findings')
    const open = new Map(); for (const f of findings) open.set(f.fingerprint, f)
    const openCount = [...open.values()].filter(f => f.status === 'open').length
    console.log(`# Ledger summary\n\nCycles: ${cycles.length}  |  Findings: ${open.size} (open: ${openCount})\n`)
    console.log('| epic | verdict | rounds | SEV1/2 | escalations | ts |\n|---|---|---|---|---|---|')
    for (const c of cycles) console.log(`| ${c.epic} | ${c.verdict} | ${c.rounds ?? ''} | ${c.blocking_findings ?? ''} | ${(c.escalations || []).length} | ${c.ts} |`)
    break
  }
  default:
    console.error('usage: ledger.mjs append|fingerprint|query|closed|close|recent|summary'); process.exit(1)
}

#!/usr/bin/env node
// Definition-of-Done checker (PROTOCOL §10). Usage:
//   node agentic/scripts/dod.mjs --epic EPIC-ID [--cycle agentic/ledger/cycles/<id>] [--json]
// Reads: agentic/ledger/last-gate.json, <cycle>/adjudication.json, <cycle>/qa-visual/manifest.json,
//        CHANGELOG.md, agentic/ledger/cycles.jsonl, docs/adr/*.md
// Exit 0 only when every item is satisfied. Prints the checklist either way.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const root = process.cwd()
const epic = opt('--epic')
if (!epic) { console.error('dod: --epic required'); process.exit(1) }
const cycleDir = opt('--cycle', join('agentic', 'ledger', 'cycles', epic))
const cfg = JSON.parse(readFileSync(join(root, 'agentic', 'gates.json'), 'utf8'))
const readJson = (p) => { try { return JSON.parse(readFileSync(join(root, p), 'utf8')) } catch { return null } }
const items = []
const check = (id, label, ok, detail) => items.push({ id, label, ok: !!ok, detail })

// 1 & 2: adjudication + gates
const adj = readJson(join(cycleDir, 'adjudication.json'))
check(1, 'Every AC PASS with verifier/gate evidence', adj && Array.isArray(adj.rows) && adj.rows.length > 0 && adj.rows.every(r => r.verdict === 'PASS' && r.evidence && !/maker|self/i.test(r.evidence_source || '')), adj ? `${(adj.rows || []).filter(r => r.verdict === 'PASS').length}/${(adj.rows || []).length} PASS` : 'no adjudication.json')
const gate = readJson('agentic/ledger/last-gate.json')
check(2, 'All gates green on the integrated branch (integration or release profile)', gate && gate.ok && ['integration', 'release'].includes(gate.profile) && gate.skipped.length === 0, gate ? `profile=${gate.profile} ok=${gate.ok} skipped=[${gate.skipped.join(',')}]` : 'no last-gate.json')

// 3: no open SEV1/2
let findings = []
try { findings = readFileSync(join(root, 'agentic', 'ledger', 'findings.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) } catch {}
const latest = new Map(); for (const f of findings) if (f.epic === epic) latest.set(f.fingerprint, f)
const openBlocking = [...latest.values()].filter(f => f.status === 'open' && /^SEV[12]$/.test(f.sev))
check(3, 'No open SEV1/SEV2 for this epic', openBlocking.length === 0, openBlocking.map(f => `${f.sev} ${f.fingerprint} ${f.path}`).join('; ') || 'none open')

// 4: screenshots per route × widths × themes × locales
const manifest = readJson(join(cycleDir, 'qa-visual', 'manifest.json'))
let shotOk = false, shotDetail = 'no qa-visual/manifest.json'
if (manifest && Array.isArray(manifest.routes)) {
  const need = []
  for (const r of manifest.routes) for (const w of cfg.limits.screenshot_widths) for (const t of ['light', 'dark']) for (const l of ['uz', 'ru']) need.push(`${r.replace(/[^a-z0-9]+/gi, '_')}__${w}__${t}__${l}.png`)
  const have = new Set(existsSync(join(root, cycleDir, 'qa-visual')) ? readdirSync(join(root, cycleDir, 'qa-visual')) : [])
  const missing = need.filter(n => !have.has(n))
  shotOk = manifest.routes.length > 0 && missing.length === 0
  shotDetail = `${need.length - missing.length}/${need.length} screenshots present${missing.length ? `; missing e.g. ${missing.slice(0, 3).join(', ')}` : ''}`
}
check(4, 'Visual QA screenshots for every changed route (3 widths × light/dark × uz/ru)', shotOk, shotDetail)

// 5: states verified
check(5, 'Empty/loading/error/no-permission states verified by wp-qa-visual', manifest && manifest.states_verified === true, manifest ? `states_verified=${manifest.states_verified}` : 'n/a')
// 6: keyboard walkthrough
const a11y = readJson(join(cycleDir, 'a11y-i18n.json'))
check(6, 'Keyboard-only walkthrough recorded by wp-a11y-i18n', a11y && a11y.keyboard_walkthrough === true && (a11y.axe_serious_critical === 0), a11y ? `keyboard=${a11y.keyboard_walkthrough} axe_serious_critical=${a11y.axe_serious_critical}` : 'no a11y-i18n.json')
// 7: demo seed
check(7, 'Demo tenant seed updated for this epic', adj && adj.demo_seed_updated === true, adj ? `demo_seed_updated=${adj.demo_seed_updated}` : 'n/a')
// 8: changelog
let changelog = ''; try { changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8') } catch {}
check(8, 'CHANGELOG.md entry in plain language', changelog.includes(epic), changelog ? (changelog.includes(epic) ? 'found' : `no "${epic}" in CHANGELOG.md`) : 'no CHANGELOG.md')
// 9: ADRs for class B/C contract decisions
const cls = adj && adj.class
const adrs = existsSync(join(root, 'docs', 'adr')) ? readdirSync(join(root, 'docs', 'adr')).filter(f => f.endsWith('.md')) : []
const adrForEpic = adrs.some(f => { try { return readFileSync(join(root, 'docs', 'adr', f), 'utf8').includes(epic) } catch { return false } })
check(9, 'ADR present when class is B/C with contract or schema change', cls === 'A' || adrForEpic || (adj && adj.contract_change === false), `class=${cls} adr_for_epic=${adrForEpic}`)
// 10: ledger
let cycles = []; try { cycles = readFileSync(join(root, 'agentic', 'ledger', 'cycles.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) } catch {}
check(10, 'Ledger entry appended', cycles.some(c => c.epic === epic && c.verdict), cycles.some(c => c.epic === epic) ? 'found' : 'none')

const ok = items.every(i => i.ok)
if (args.includes('--json')) console.log(JSON.stringify({ epic, ok, items }, null, 2))
else {
  console.log(`# DoD ${epic}: ${ok ? 'DONE' : 'NOT DONE'}`)
  for (const i of items) console.log(`${i.ok ? '✅' : '❌'} ${i.id}. ${i.label} — ${i.detail}`)
}
process.exit(ok ? 0 : 1)

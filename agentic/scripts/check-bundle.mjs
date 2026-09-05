#!/usr/bin/env node
// Bundle budget gate: gzipped size of the largest JS chunk in the web build must be under gates.json limits.bundle_main_kb_max.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const root = process.cwd()
const cfg = JSON.parse(readFileSync(join(root, 'agentic', 'gates.json'), 'utf8'))
const max = cfg.limits.bundle_main_kb_max
const candidates = ['apps/web/dist/assets', 'apps/web/dist', 'apps/web/.output/public/assets', 'apps/web/build/client/assets']
const dir = candidates.map(c => join(root, c)).find(existsSync)
if (!dir) { console.error(`[bundle] no build output found (${candidates.join(' | ')}). Run the build gate first.`); process.exit(1) }
const walk = (d, acc = []) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, acc); else if (/\.js$/.test(e)) acc.push(p) } return acc }
const rows = walk(dir).map(p => ({ file: p.replace(root, '.'), raw: statSync(p).size, gz: gzipSync(readFileSync(p)).length })).sort((a, b) => b.gz - a.gz)
const total = rows.reduce((s, r) => s + r.gz, 0)
for (const r of rows.slice(0, 8)) console.log(`[bundle] ${(r.gz / 1024).toFixed(1)} kB gz  ${(r.raw / 1024).toFixed(0)} kB raw  ${r.file}`)
const largest = rows[0] ? rows[0].gz / 1024 : 0
console.log(`[bundle] largest chunk ${largest.toFixed(1)} kB gz (budget ${max} kB); total JS ${(total / 1024).toFixed(0)} kB gz`)
process.exit(largest <= max ? 0 : 1)

#!/usr/bin/env node
// i18n gate: every key used in the web app exists in every locale; locales have identical key sets;
// hard-coded JSX text is reported (blocking once the allowlist is exhausted).
// Config: agentic/i18n.config.json (optional) { "src": "apps/web/src", "messages": "packages/i18n/messages", "locales": ["uz","ru","en"], "allow_hardcoded": ["..."] }
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = process.cwd()
const cfg = Object.assign({ src: 'apps/web/src', messages: 'packages/i18n/messages', locales: ['uz', 'ru', 'en'], allow_hardcoded: [] },
  existsSync(join(root, 'agentic', 'i18n.config.json')) ? JSON.parse(readFileSync(join(root, 'agentic', 'i18n.config.json'), 'utf8')) : {})

if (!existsSync(join(root, cfg.src))) { console.log(`[i18n] ${cfg.src} not found (pre-scaffold) — nothing to check`); process.exit(existsSync(join(root, 'package.json')) ? 1 : 0) }

const walk = (d, acc = []) => { for (const e of readdirSync(d)) { const p = join(d, e); const s = statSync(p); if (s.isDirectory()) { if (!/node_modules|dist|\.next|coverage/.test(e)) walk(p, acc) } else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(e))) acc.push(p) } return acc }
const files = walk(join(root, cfg.src))

const flatten = (obj, prefix = '', out = {}) => { for (const [k, v] of Object.entries(obj || {})) { const key = prefix ? `${prefix}.${k}` : k; if (v && typeof v === 'object') flatten(v, key, out); else out[key] = v } return out }
const dict = {}
for (const l of cfg.locales) {
  const p = join(root, cfg.messages, `${l}.json`)
  if (!existsSync(p)) { console.error(`[i18n] missing locale file ${p}`); process.exit(1) }
  dict[l] = flatten(JSON.parse(readFileSync(p, 'utf8')))
}
const base = cfg.locales[0]
let errors = 0
for (const l of cfg.locales.slice(1)) {
  const missing = Object.keys(dict[base]).filter(k => !(k in dict[l]))
  const extra = Object.keys(dict[l]).filter(k => !(k in dict[base]))
  if (missing.length) { errors += missing.length; console.log(`[i18n] ${l}: ${missing.length} keys missing vs ${base}: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`) }
  if (extra.length) { errors += extra.length; console.log(`[i18n] ${l}: ${extra.length} extra keys not in ${base}: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ' …' : ''}`) }
  const empty = Object.entries(dict[l]).filter(([, v]) => String(v).trim() === '').map(([k]) => k)
  if (empty.length) { errors += empty.length; console.log(`[i18n] ${l}: ${empty.length} empty translations: ${empty.slice(0, 10).join(', ')}`) }
}

const keyRe = /\bt\(\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g
const transRe = /i18nKey=['"]([a-zA-Z0-9_.-]+)['"]/g
const used = new Map()
for (const f of files) { const s = readFileSync(f, 'utf8'); for (const re of [keyRe, transRe]) { let m; re.lastIndex = 0; while ((m = re.exec(s))) used.set(m[1], f) } }
const unknown = [...used.entries()].filter(([k]) => !(k in dict[base]))
if (unknown.length) { errors += unknown.length; console.log(`[i18n] ${unknown.length} used keys missing in ${base}.json:`); for (const [k, f] of unknown.slice(0, 20)) console.log(`   ${k}  (${f.replace(root, '.')})`) }

// hard-coded text heuristic: JSX text nodes with 3+ letters (Latin or Cyrillic) not inside t()/Trans
const hard = []
const textRe = />\s*([^<>{}\n]*[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]{3,}[^<>{}\n]*)\s*</g
for (const f of files.filter(f => f.endsWith('.tsx') || f.endsWith('.jsx'))) {
  const s = readFileSync(f, 'utf8'); let m
  while ((m = textRe.exec(s))) { const txt = m[1].trim(); if (!txt || /^[\d\s.,:;%()/+-]*$/.test(txt) || cfg.allow_hardcoded.includes(txt)) continue; hard.push({ f: f.replace(root, '.'), txt }) }
}
if (hard.length) { errors += hard.length; console.log(`[i18n] ${hard.length} hard-coded UI strings (wrap in t() or add to allow_hardcoded):`); for (const h of hard.slice(0, 25)) console.log(`   "${h.txt}"  ${h.f}`) }

console.log(`[i18n] locales=${cfg.locales.join(',')} keys=${Object.keys(dict[base]).length} used=${used.size} errors=${errors}`)
process.exit(errors ? 1 : 0)

#!/usr/bin/env node
// i18n gate: every key used in the web app exists in every locale; locales have identical key sets;
// hard-coded JSX text is reported (blocking once the allowlist is exhausted).
// Config: agentic/i18n.config.json (optional) { "src": "apps/web/src", "messages": "packages/i18n/messages", "locales": ["uz","ru","en"], "allow_hardcoded": ["..."] }
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = process.cwd()
const cfg = Object.assign(
  {
    src: 'apps/web/src',
    messages: 'packages/i18n/messages',
    modules: 'packages/i18n/messages/modules',
    locales: ['uz', 'ru', 'en'],
    allow_hardcoded: [],
  },
  existsSync(join(root, 'agentic', 'i18n.config.json'))
    ? JSON.parse(readFileSync(join(root, 'agentic', 'i18n.config.json'), 'utf8'))
    : {},
)

// Modules (MODULE-GUIDE.md "i18n messages") never edit the shared catalogues -- each drops its own
// `messages/modules/<name>/<locale>.json`, and `pnpm --filter @devon/i18n messages:merge` folds those
// into the `<locale>.generated.json` the running app loads. This gate merges the same module files
// in-memory instead of trusting that generated output, so "the gate is green" never depends on someone
// having remembered to re-run the merge before checking it in.
function listModuleNames() {
  const dir = join(root, cfg.modules)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}
function mergeModulesInto(tree, locale) {
  for (const name of listModuleNames()) {
    const p = join(root, cfg.modules, name, `${locale}.json`)
    if (!existsSync(p)) continue
    deepMerge(tree, JSON.parse(readFileSync(p, 'utf8')))
  }
  return tree
}
function deepMerge(base, incoming) {
  for (const [k, v] of Object.entries(incoming)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!base[k] || typeof base[k] !== 'object') base[k] = {}
      deepMerge(base[k], v)
    } else {
      base[k] = v
    }
  }
  return base
}

if (!existsSync(join(root, cfg.src))) {
  console.log(
    `[i18n] WARNING: ${cfg.src} not found yet — nothing to check (this becomes a real check once the web app exists)`,
  )
  process.exit(0)
}

const walk = (d, acc = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (!/node_modules|dist|\.next|coverage/.test(e)) walk(p, acc)
    } else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(e))) acc.push(p)
  }
  return acc
}
const files = walk(join(root, cfg.src))

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out[key] = v
  }
  return out
}
const dict = {}
for (const l of cfg.locales) {
  const p = join(root, cfg.messages, `${l}.json`)
  if (!existsSync(p)) {
    console.error(`[i18n] missing locale file ${p}`)
    process.exit(1)
  }
  const tree = mergeModulesInto(JSON.parse(readFileSync(p, 'utf8')), l)
  dict[l] = flatten(tree)
}
const base = cfg.locales[0]
let errors = 0
for (const l of cfg.locales.slice(1)) {
  const missing = Object.keys(dict[base]).filter((k) => !(k in dict[l]))
  const extra = Object.keys(dict[l]).filter((k) => !(k in dict[base]))
  if (missing.length) {
    errors += missing.length
    console.log(
      `[i18n] ${l}: ${missing.length} keys missing vs ${base}: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`,
    )
  }
  if (extra.length) {
    errors += extra.length
    console.log(
      `[i18n] ${l}: ${extra.length} extra keys not in ${base}: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ' …' : ''}`,
    )
  }
  const empty = Object.entries(dict[l])
    .filter(([, v]) => String(v).trim() === '')
    .map(([k]) => k)
  if (empty.length) {
    errors += empty.length
    console.log(`[i18n] ${l}: ${empty.length} empty translations: ${empty.slice(0, 10).join(', ')}`)
  }
}

// The generated catalogues have to agree with the module files this gate just merged in memory.
//
// Found the hard way on 2026-09-13: two new `home.head.catchUp.*` keys were added to all four module
// files, this gate went green -- it reads the modules, by design, so that green never depends on
// somebody remembering to re-run the merge -- and the running product rendered
// the raw key marker on the head's dashboard, because `messages/<locale>.generated.json` is what
// `@devon/i18n` actually loads and it was stale in the working tree.
//
// So the gate now checks the other half of the same sentence: the checked-in generated output must
// equal the merge. That keeps the in-memory merge as the source of truth for *correctness* while
// making "the gate is green" and "the app renders the string" the same claim, which is the whole
// point of having this gate. The fix when it fails is one command, and the message says so.
for (const l of cfg.locales) {
  const generatedPath = join(root, cfg.messages, `${l}.generated.json`)
  if (!existsSync(generatedPath)) {
    errors += 1
    console.log(
      `[i18n] ${l}: ${cfg.messages}/${l}.generated.json is missing -- run: pnpm --filter @devon/i18n messages:merge`,
    )
    continue
  }
  const generated = flatten(JSON.parse(readFileSync(generatedPath, 'utf8')))
  const stale = Object.keys(dict[l]).filter((k) => generated[k] !== dict[l][k])
  const orphaned = Object.keys(generated).filter((k) => !(k in dict[l]))
  if (stale.length || orphaned.length) {
    errors += stale.length + orphaned.length
    const sample = [...stale, ...orphaned].slice(0, 10).join(', ')
    console.log(
      `[i18n] ${l}: ${l}.generated.json is out of date with the module message files ` +
        `(${stale.length} stale/missing, ${orphaned.length} orphaned): ${sample}` +
        `${stale.length + orphaned.length > 10 ? ' ...' : ''}`,
    )
    console.log(`[i18n] ${l}: fix with -- pnpm --filter @devon/i18n messages:merge`)
  }
}


const keyRe = /\bt\(\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g
const transRe = /i18nKey=['"]([a-zA-Z0-9_.-]+)['"]/g
const used = new Map()
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const re of [keyRe, transRe]) {
    let m
    re.lastIndex = 0
    while ((m = re.exec(s))) used.set(m[1], f)
  }
}
const unknown = [...used.entries()].filter(([k]) => !(k in dict[base]))
if (unknown.length) {
  errors += unknown.length
  console.log(`[i18n] ${unknown.length} used keys missing in ${base}.json:`)
  for (const [k, f] of unknown.slice(0, 20)) console.log(`   ${k}  (${f.replace(root, '.')})`)
}

// hard-coded text heuristic: JSX text nodes with 3+ letters (Latin or Cyrillic) not inside t()/Trans
const hard = []
const textRe = />\s*([^<>{}\n]*[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]{3,}[^<>{}\n]*)\s*</g
for (const f of files.filter((f) => f.endsWith('.tsx') || f.endsWith('.jsx'))) {
  const s = readFileSync(f, 'utf8')
  let m
  while ((m = textRe.exec(s))) {
    const txt = m[1].trim()
    if (!txt || /^[\d\s.,:;%()/+-]*$/.test(txt) || cfg.allow_hardcoded.includes(txt)) continue
    hard.push({ f: f.replace(root, '.'), txt })
  }
}
if (hard.length) {
  errors += hard.length
  console.log(
    `[i18n] ${hard.length} hard-coded UI strings (wrap in t() or add to allow_hardcoded):`,
  )
  for (const h of hard.slice(0, 25)) console.log(`   "${h.txt}"  ${h.f}`)
}

// round2 SEV2 #17: uz-Latn copy mixed an ASCII apostrophe with the correct U+02BB modifier letter for
// the same oʻ/gʻ sound (327 vs 369 sequences, counted by hand) -- normalised by a scripted replace,
// this keeps a new offender from creeping back in. Only the [ogOG]' shape is checked (a real
// quotation mark after any other letter is not this bug).
const apostropheRe = /[ogOG]'/
const uzLatnFiles = [
  join(root, cfg.messages, 'uz-Latn.json'),
  ...listModuleNames().map((n) => join(root, cfg.modules, n, 'uz-Latn.json')),
].filter(existsSync)
let apostropheHits = 0
for (const p of uzLatnFiles) {
  const tree = JSON.parse(readFileSync(p, 'utf8'))
  for (const [k, v] of Object.entries(flatten(tree))) {
    if (typeof v === 'string' && apostropheRe.test(v)) {
      apostropheHits++
      if (apostropheHits <= 20)
        console.log(
          `[i18n] uz-Latn ASCII apostrophe (use U+02BB ʻ) in "${k}" (${p.replace(root, '.')}): "${v}"`,
        )
    }
  }
}
if (apostropheHits) errors += apostropheHits

// round2 SEV2 #8: DESIGN.md §2.1 keeps green (Badge tone="success") for success/approved/on-track
// only -- "active", "configured", "current" and "head" all leaked onto it. New `tone="success"` call
// sites must be added to this allowlist deliberately rather than silently reintroducing the bug.
const successToneAllowlist = new Set([
  'apps/web/src/features/accounts/account-settings-screen.tsx',
  'apps/web/src/features/accounts/password-strength.tsx',
  'apps/web/src/features/admin/audit-screen.tsx',
  // v1.1 critique SEV2 #26: the admin health snapshot now writes each check's state beside its dot
  // (DESIGN.md §6 forbids colour as the only signal). `ok` -- "this dependency is healthy right now"
  // -- is exactly the on-track meaning §2.1 reserves green for; the other three map to
  // warning/destructive/warning, and an unconfigured backup is deliberately NOT neutral.
  'apps/web/src/features/admin/dashboard-screen.tsx',
  'apps/web/src/features/ai/ai-settings-screen.tsx',
  'apps/web/src/features/departments/approval-queue-screen.tsx',
  'apps/web/src/features/departments/components/pending-request-view.tsx',
  'apps/web/src/features/departments/create-request-screen.tsx',
  'apps/web/src/features/events/components/carpool-panel.tsx',
  'apps/web/src/features/inbox/reason-icon.tsx',
  'apps/web/src/features/inbox/telegram-screen.tsx',
  'apps/web/src/features/personal/sprints-view.tsx',
  'apps/web/src/features/projects/components/project-tile.tsx',
])
// Matches both a literal `tone="success"`/`tone={... 'success' ...}` on a JSX tag and a `'success'`
// entry in a `STATUS_TONE`-style lookup map later spread onto `tone={...}` -- the exact shape the
// original admin "Faol" bug took (`active: 'success'` in a status->tone `Record`, not a literal on
// the tag itself). Scoped to files that import `Badge` or `Chip` at all, so this stays a tone lint
// rather than flagging the unrelated `'success'` string states (`useState<'success' | 'error'>`,
// password-confirmation toasts) that plenty of screens with no Badge/Chip also use.
const successToneRe = /['"]success['"]/
let successToneHits = 0
for (const f of files.filter((f) => f.endsWith('.tsx'))) {
  const rel = f
    .replace(root, '.')
    .replace(/^\.[\\/]/, '')
    .replace(/\\/g, '/')
  if (successToneAllowlist.has(rel)) continue
  const s = readFileSync(f, 'utf8')
  if (!/\b(Badge|Chip)\b/.test(s)) continue
  if (successToneRe.test(s)) {
    successToneHits++
    console.log(
      `[i18n] new tone="success" call site not in the allowlist (DESIGN.md §2.1: green is success/approved/on-track only) -- ${rel}`,
    )
  }
}
if (successToneHits) errors += successToneHits

console.log(
  `[i18n] locales=${cfg.locales.join(',')} keys=${Object.keys(dict[base]).length} used=${used.size} errors=${errors}`,
)
process.exit(errors ? 1 : 0)

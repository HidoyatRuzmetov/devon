#!/usr/bin/env node
// `pnpm -w arch:urls` -- HARDENING H28.1 "no hardcoded URLs (grep)". Pure Node (no `grep` dependency,
// so this runs identically on the Windows dev box and Linux CI) walking every workspace package's
// `src/` for an `http(s)://<host>` literal, and failing on anything not in ALLOWLIST below.
//
// Every entry in ALLOWLIST was reviewed by hand (this run, ops-tooling package) and is one of:
//   - a frozen product decision with its own ADR/TECH-SPEC line (the GLM endpoint, decision #1 --
//     still overridable by env, this is only its *default*), never a silently-different-per-
//     environment value a real deployment would need to change without an env var to do it;
//   - an RFC 9457 `type` member (a URI *identifier*, per the RFC never dereferenced over the network
//     -- `https://devon.local/problems/...`), not a network endpoint at all;
//   - a genuine third-party constant with no per-deployment variant (`https://t.me/...` -- Telegram's
//     own domain for deep links, not something a self-hosted deployment would ever repoint);
//   - demo seed content or a doc-comment example, never executed as a request target.
// A new literal HTTP(S) URL appearing anywhere else in application source is exactly the smell this
// check exists to catch -- add it to ALLOWLIST (with the same kind of justification) only if a review
// concludes it truly cannot vary per deployment; otherwise move it to config/env.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const TARGET_DIRS = [
  'apps/api/src',
  'apps/web/src',
  'packages/ai/src',
  'packages/contracts/src',
  'packages/db/src',
  'packages/i18n/src',
  'packages/ui/src',
]

// { file: relative path from repo root (POSIX separators), url: the exact literal }
const ALLOWLIST = [
  { file: 'packages/ai/src/config.ts', url: 'https://api-llm.gpu.uz' }, // decision #1: GLM endpoint default, env-overridable
  { file: 'apps/api/src/modules/admin/repo.ts', url: 'https://api-llm.gpu.uz' }, // masked display of the configured AI endpoint on the health page
  { file: 'packages/contracts/src/problem.ts', url: 'https://devon.local' }, // RFC 9457 `type` URI namespace, never dereferenced
  { file: 'apps/api/src/app.ts', url: 'https://devon.local' }, // same RFC 9457 `type` namespace
  { file: 'apps/api/src/modules/telegram/index.ts', url: 'https://t.me' }, // Telegram's own domain, not a deployment-specific endpoint
  { file: 'apps/api/src/modules/telegram/pointer.ts', url: 'https://portal.example' }, // doc-comment / fixture example, not executed
  { file: 'packages/db/src/seed/modules/work.ts', url: 'https://digital.egov.uz' }, // demo seed card content (a sample link), not a request target
  { file: 'apps/web/src/features/work/lib/quick-add.ts', url: 'https://example.com' }, // doc-comment example, not executed
  { file: 'packages/db/src/seed/modules/events.ts', url: 'https://maps.example.com' }, // demo seed event content (RFC 2606 reserved example domain)
  { file: 'packages/db/src/seed/modules/events.ts', url: 'https://images.example.com' }, // demo seed photo URLs (RFC 2606 reserved example domain)
]
const allowed = new Set(ALLOWLIST.map((e) => `${e.file}::${e.url}`))

const URL_RE = /https?:\/\/[a-zA-Z0-9._-]+/g
const SAFE_HOST_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$|^http:\/\/www\.w3\.org$/ // dev-only
// hosts, and the XML/SVG namespace URI (`xmlns="http://www.w3.org/2000/svg"` etc.) -- a required
// identifier attribute on every SVG element in this codebase's UI illustrations, never dereferenced
// over the network, not a real HTTP request target.

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue
      walk(p, out)
    } else if (['.ts', '.tsx'].includes(extname(entry)) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

let violations = []
for (const dir of TARGET_DIRS) {
  const absDir = join(ROOT, dir)
  let files
  try { files = walk(absDir) } catch { continue }
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/')
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      const matches = line.match(URL_RE)
      if (!matches) return
      for (const m of matches) {
        if (SAFE_HOST_RE.test(m)) continue
        if (allowed.has(`${rel}::${m}`)) continue
        violations.push(`${rel}:${i + 1}: ${m}  (${line.trim().slice(0, 100)})`)
      }
    })
  }
}

if (violations.length > 0) {
  console.error('[arch:urls] FAILED -- hardcoded URL(s) not in tools/arch/no-hardcoded-urls.mjs\'s ALLOWLIST:\n')
  for (const v of violations) console.error(`  ${v}`)
  console.error('\nMove it to config/env, or add it to ALLOWLIST with a reviewed justification (HARDENING H28.1).')
  process.exit(1)
}
console.log('[arch:urls] PASS -- every hardcoded URL in application source is on the reviewed allowlist (or is a dev-only localhost default).')

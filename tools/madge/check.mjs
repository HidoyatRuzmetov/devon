#!/usr/bin/env node
// `pnpm -w madge` -- HARDENING H28.1 "no circular deps (madge check)". Uses madge's Node API (not the
// CLI) so a single process can check every workspace package's own source tree with one exact-pinned
// dependency, rather than juggling per-package CLI invocations and glob expansion across shells.
import madge from 'madge'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const TARGETS = [
  'apps/api/src',
  'apps/web/src',
  'packages/ai/src',
  'packages/contracts/src',
  'packages/db/src',
  'packages/i18n/src',
  'packages/ui/src',
]

const MADGE_CONFIG = {
  fileExtensions: ['ts', 'tsx'],
  tsConfig: join(ROOT, 'tsconfig.base.json'),
  detectiveOptions: { ts: { skipTypeImports: true } },
}

let anyCircular = false
for (const target of TARGETS) {
  const dir = join(ROOT, target)
  // eslint-disable-next-line no-await-in-loop -- sequential by design: each target is an independent,
  // small workspace package tree (H29.1 targets await-in-loop over *independent* items fetched from
  // one source, e.g. a list of ids -- this is a small, fixed, hand-written list of directories, not
  // that pattern).
  const res = await madge(dir, MADGE_CONFIG)
  const circular = res.circular()
  if (circular.length > 0) {
    anyCircular = true
    console.error(`\n[madge] circular dependencies in ${target}:`)
    for (const cycle of circular) console.error(`  - ${cycle.join(' -> ')}`)
  } else {
    console.log(`[madge] ${target}: no circular dependencies (${Object.keys(res.obj()).length} file(s) checked)`)
  }
}

if (anyCircular) {
  console.error('\n[madge] FAILED -- circular dependencies found (see above). HARDENING H28.1.')
  process.exit(1)
}
console.log('\n[madge] PASS -- no circular dependencies in any workspace package.')

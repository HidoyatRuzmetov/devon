#!/usr/bin/env node
// `pnpm --filter @devon/i18n break:hardcoded` (design.md §9, AC-3 evidence producer). `apps/web`
// does not exist yet in this item (EPIC-000.3 explicitly does not touch it -- EPIC-000.7 builds the
// shell afterward), so there is no real component tree to plant a hard-coded string in. Instead
// this script points `agentic/i18n.config.json`'s `src` at a throwaway fixture directory *outside*
// the repository (the OS temp dir), containing exactly one hard-coded, un-wrapped UI string, runs
// the real `agentic/scripts/check-i18n.mjs` gate against it, and restores `agentic/i18n.config.json`
// byte-for-byte in a `finally`. `agentic/i18n.config.json` is the one file this item owns that the
// gate reads its `src` path from (design.md §1.3), so this is the only way to exercise the
// hard-coded-string branch of the shared, protected gate script without touching `apps/web`.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { REPO_ROOT } from '../terms.js'

function main(): void {
  const configPath = join(REPO_ROOT, 'agentic', 'i18n.config.json')
  const originalConfig = readFileSync(configPath, 'utf8')
  const config = JSON.parse(originalConfig) as Record<string, unknown>

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'devon-i18n-break-hardcoded-'))
  const fixtureSrc = join(fixtureRoot, 'src')
  mkdirSync(fixtureSrc, { recursive: true })
  writeFileSync(
    join(fixtureSrc, 'Fixture.tsx'),
    ['export function Fixture() {', '  return <button>Bekor qilish endi</button>', '}', ''].join(
      '\n',
    ),
    'utf8',
  )

  // check-i18n.mjs resolves `cfg.src` with `join(root, cfg.src)` -- `path.join` always treats its
  // second argument as relative (an absolute-looking string there produces a garbage concatenation,
  // verified empirically), so `cfg.src` must be `path.relative(root, fixtureSrc)`, `..`-segments and
  // all, not the fixture's absolute path.
  const relativeSrc = relative(REPO_ROOT, fixtureSrc).replace(/\\/g, '/')
  const patchedConfig = { ...config, src: relativeSrc }

  try {
    writeFileSync(configPath, JSON.stringify(patchedConfig, null, 2) + '\n', 'utf8')
    console.log(`[break-hardcoded] pointed agentic/i18n.config.json src at ${relativeSrc}`)
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'agentic', 'scripts', 'check-i18n.mjs')],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    )
    console.log(result.stdout)
    if (result.stderr) console.error(result.stderr)
    const gateCaughtIt = result.status !== 0
    console.log(
      gateCaughtIt
        ? `[break-hardcoded] OK -- check-i18n.mjs exited ${result.status} as expected (the gate caught the hard-coded string)`
        : '[break-hardcoded] FAIL -- check-i18n.mjs exited 0 over a hard-coded string -- the gate has a hole',
    )
    process.exitCode = gateCaughtIt ? 0 : 1
  } finally {
    writeFileSync(configPath, originalConfig, 'utf8')
    rmSync(fixtureRoot, { recursive: true, force: true })
    console.log(
      '[break-hardcoded] reverted agentic/i18n.config.json and removed the fixture directory',
    )
  }
}

main()

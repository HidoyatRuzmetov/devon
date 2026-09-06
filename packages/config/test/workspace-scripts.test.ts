// The AC-14 non-vacuity backstop for `pnpm -r --if-present <script>`.
//
// `agentic/gates.json`'s typecheck/lint/unit gates run `pnpm -r --if-present <script>`, which exits 0
// even when *zero* workspace packages define that script -- a gate that "passes" without checking
// anything. This test enumerates every package pnpm-workspace.yaml can see and fails loudly the
// moment one of them is missing `typecheck`, `lint`, `test:unit` or `build`, so that scenario can
// never happen silently. Every downstream work item must declare all four from day one, even as a
// one-line stub (design.md §7.3: "even if the body is `tsc --noEmit -p .` / `eslint .` / `vitest run`
// / `echo built`").
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_SCRIPTS = ['typecheck', 'lint', 'test:unit', 'build'] as const

// packages/config/test -> packages/config -> packages -> <repo root>
const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))

/** Minimal YAML-list reader for pnpm-workspace.yaml's `packages:` block. No YAML dependency needed
 *  for a handful of `- glob` lines; a real parser is overkill and would be one more pinned version
 *  to track for a file this small and this stable. */
function readWorkspaceGlobs(workspaceFile: string): string[] {
  const lines = readFileSync(workspaceFile, 'utf8').split(/\r?\n/)
  const globs: string[] = []
  let inPackages = false
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '')
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const m = line.match(/^\s*-\s*(.+?)\s*$/)
      const value = m?.[1]
      if (value) {
        globs.push(value.replace(/^['"]|['"]$/g, ''))
        continue
      }
      if (line.trim() === '') continue
      break // a non-list, non-blank line ends the `packages:` block
    }
  }
  return globs
}

/** Only the one glob shape pnpm-workspace.yaml actually uses here: `<dir>/*`. Anything else is a
 *  workspace-file change this test does not understand yet -- fail loudly rather than skip silently. */
function expandGlob(glob: string): string[] {
  if (!glob.endsWith('/*')) {
    throw new Error(
      `workspace-scripts.test.ts cannot expand glob "${glob}" (only "<dir>/*" is supported). Update this test alongside pnpm-workspace.yaml.`,
    )
  }
  const parent = join(root, glob.slice(0, -2))
  if (!existsSync(parent)) return []
  return readdirSync(parent)
    .map((name) => join(parent, name))
    .filter((p) => statSync(p).isDirectory())
    .filter((p) => existsSync(join(p, 'package.json')))
}

function discoverPackages(): { dir: string; pkg: Record<string, unknown> }[] {
  const workspaceFile = join(root, 'pnpm-workspace.yaml')
  const globs = readWorkspaceGlobs(workspaceFile)
  expect(
    globs.length,
    'pnpm-workspace.yaml must declare at least one `packages:` glob',
  ).toBeGreaterThan(0)
  const dirs = globs.flatMap(expandGlob)
  return dirs.map((dir) => ({
    dir,
    pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
  }))
}

describe('every workspace package declares typecheck/lint/test:unit/build', () => {
  const packages = discoverPackages()

  it('found at least one workspace package to check (otherwise this test is vacuous too)', () => {
    expect(packages.length).toBeGreaterThan(0)
  })

  it.each(packages.map((p) => [p.dir, p] as const))('%s', (_label, { dir, pkg }) => {
    const scripts = (pkg['scripts'] as Record<string, string> | undefined) ?? {}
    const missing = REQUIRED_SCRIPTS.filter(
      (name) => typeof scripts[name] !== 'string' || scripts[name]?.trim() === '',
    )
    expect(
      missing,
      `${dir.replace(root, '.')} is missing script(s): ${missing.join(', ')} -- pnpm -r --if-present would silently skip it`,
    ).toEqual([])
  })
})

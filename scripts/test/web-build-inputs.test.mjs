import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { productionBuildInputs } from '../../tools/perf/web-build.mjs'

test('production receipt hashes actual entry/shared public and alternative app HTML/public inputs', () => {
  const scratch = resolve(import.meta.dirname, '../../apps/web/test/.tmp')
  mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(join(scratch, 'build-inputs-'))
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: fixture, encoding: 'utf8' })
    assert.equal(initialized.status, 0, initialized.stderr)
    const inputs = [
      'apps/web/src/index.html',
      'packages/ui/public/fonts/example.woff2',
      'apps/web/index.html',
      'apps/web/public/example.svg',
      'apps/web/scripts/build.mjs',
      'apps/web/src/vite.config.ts',
    ]
    for (const path of inputs) {
      const file = join(fixture, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, 'Example initial source')
    }
    const before = productionBuildInputs(fixture)
    assert.deepEqual(before.manifest.map(({ path }) => path).sort(), [...inputs].sort())
    for (const path of inputs) {
      const file = join(fixture, path)
      writeFileSync(file, 'Example changed build input')
      assert.notEqual(productionBuildInputs(fixture).sha256, before.sha256, path)
      writeFileSync(file, 'Example initial source')
      assert.equal(productionBuildInputs(fixture).sha256, before.sha256, path)
    }
  } finally {
    assert.equal(dirname(fixture), scratch)
    rmSync(fixture, { recursive: true, force: true })
  }
})

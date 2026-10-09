import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const api = join(root, 'apps/api')

test('supported API start follows the compiler output and loads workspace TypeScript exports', () => {
  const pkg = JSON.parse(readFileSync(join(api, 'package.json'), 'utf8'))
  const config = JSON.parse(readFileSync(join(api, 'tsconfig.json'), 'utf8'))
  assert.equal(config.compilerOptions.rootDir, '.')
  assert.equal(config.compilerOptions.outDir, 'dist')
  const args = pkg.scripts.start.split(' ')
  assert.equal(args.shift(), 'node')
  assert.equal(args.at(-1), 'dist/src/server.js', 'src/server.ts is emitted below dist/src')
  assert.deepEqual(args.slice(0, -1), ['--import', 'tsx'])

  const scratch = join(api, 'test/.tmp')
  mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(join(scratch, 'production-start-'))
  try {
    const entry = join(fixture, 'server.js')
    // The real workspace barrel has .js references to TypeScript sources, just like the API runtime.
    writeFileSync(
      entry,
      "import { normalizeUz } from '@devon/db'; if (typeof normalizeUz !== 'function') throw new Error('Workspace export missing'); console.log('workspace export loaded');",
    )
    const withoutLoader = spawnSync(process.execPath, [entry], {
      cwd: api,
      env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 15_000,
    })
    assert.notEqual(withoutLoader.status, 0)
    assert.match(withoutLoader.stderr, /ERR_MODULE_NOT_FOUND/)
    const loaded = spawnSync(process.execPath, [...args.slice(0, -1), entry], {
      cwd: api,
      env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 15_000,
    })
    assert.equal(loaded.status, 0, loaded.stderr || loaded.error?.message)
    assert.equal(loaded.stdout.trim(), 'workspace export loaded')
  } finally {
    assert.equal(dirname(fixture), scratch)
    rmSync(fixture, { recursive: true, force: true })
  }
})

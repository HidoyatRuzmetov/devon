import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const web = join(root, 'apps/web')
const require = createRequire(join(web, 'package.json'))
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

test('the supported web build emits React production code despite a development environment', () => {
  const scratch = join(web, 'test/.tmp')
  mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(join(scratch, 'production-build-'))
  try {
    mkdirSync(join(fixture, 'src'))
    mkdirSync(join(fixture, 'scripts'))
    writeFileSync(join(fixture, 'package.json'), '{"type":"module"}')
    writeFileSync(join(fixture, '.env'), 'NODE_ENV=development\n')
    writeFileSync(
      join(fixture, 'src/index.html'),
      '<div id="root"></div><script type="module" src="/main.js"></script>',
    )
    writeFileSync(
      join(fixture, 'src/main.js'),
      "import { createElement } from 'react'; import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')).render(createElement('p', null, 'Build receipt'));",
    )
    writeFileSync(
      join(fixture, 'src/vite.config.ts'),
      "import { defineConfig } from 'vite'; import { fileURLToPath } from 'node:url'; export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), envDir: '..', publicDir: false, build: { outDir: '../dist', sourcemap: true } });",
    )
    const entry = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')).scripts.build.split(
      ' && ',
    )[0]
    let args
    if (entry === 'vite build --config src/vite.config.ts') {
      args = [vite, 'build', '--config', 'src/vite.config.ts']
    } else {
      assert.equal(
        entry,
        'node scripts/build.mjs',
        'the supported build must use the guarded entry point',
      )
      writeFileSync(
        join(fixture, 'scripts/build.mjs'),
        readFileSync(join(web, 'scripts/build.mjs')),
      )
      args = [join(fixture, 'scripts/build.mjs')]
    }
    const built = spawnSync(process.execPath, args, {
      cwd: fixture,
      env: { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '', DEVON_E2E: '0' },
      encoding: 'utf8',
      timeout: 60_000,
    })
    assert.equal(built.status, 0, built.stderr || built.error?.message || 'fixture build failed')
    const sources = readdirSync(join(fixture, 'dist/assets'))
      .filter((file) => file.endsWith('.map'))
      .flatMap(
        (file) => JSON.parse(readFileSync(join(fixture, 'dist/assets', file), 'utf8')).sources,
      )
    assert.ok(sources.some((source) => source.endsWith('/react-dom-client.production.js')))
    assert.ok(sources.some((source) => source.endsWith('/react.production.js')))
    assert.ok(!sources.some((source) => /react[^/]*\/cjs\/[^/]*\.development\.js$/.test(source)))
  } finally {
    assert.equal(dirname(fixture), scratch)
    rmSync(fixture, { recursive: true, force: true })
  }
})

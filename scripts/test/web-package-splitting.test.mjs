import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const scratch = join(root, 'apps/web/test/.tmp')
function build(imports, expression) {
  mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(join(scratch, 'package-splitting-'))
  try {
    mkdirSync(join(fixture, 'src'))
    mkdirSync(join(fixture, 'scripts'))
    writeFileSync(join(fixture, 'package.json'), '{"type":"module"}')
    writeFileSync(
      join(fixture, 'scripts/build.mjs'),
      readFileSync(join(root, 'apps/web/scripts/build.mjs')),
    )
    writeFileSync(
      join(fixture, 'src/index.html'),
      '<div id="root"></div><script type="module" src="/main.js"></script>',
    )
    writeFileSync(
      join(fixture, 'src/main.js'),
      `import React from 'react'; import { createRoot } from 'react-dom/client'; import '@devon/ui/styles/tokens.css'; ${imports}; createRoot(document.getElementById('root')).render(${expression});`,
    )
    writeFileSync(
      join(fixture, 'src/vite.config.ts'),
      "import { defineConfig } from 'vite'; import { fileURLToPath } from 'node:url'; export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), publicDir: false, build: { outDir: '../dist', sourcemap: true } });",
    )
    const result = spawnSync(process.execPath, [join(fixture, 'scripts/build.mjs')], {
      cwd: fixture,
      env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 60_000,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    const assets = readdirSync(join(fixture, 'dist/assets'))
    const sources = assets
      .filter((name) => name.endsWith('.map'))
      .flatMap(
        (name) => JSON.parse(readFileSync(join(fixture, 'dist/assets', name), 'utf8')).sources,
      )
    const css = assets
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join(fixture, 'dist/assets', name), 'utf8'))
      .join('\n')
    return { sources, css }
  } finally {
    assert.equal(dirname(fixture), scratch)
    rmSync(fixture, { recursive: true, force: true })
  }
}

test('a public Button consumer excludes unused calendar and schema modules and preserves imported CSS', () => {
  const result = build(
    "import { Button } from '@devon/ui'; import { DEFAULT_WEEKLY_CAPACITY_HOURS } from '@devon/contracts'",
    'React.createElement(Button, null, String(DEFAULT_WEEKLY_CAPACITY_HOURS))',
  )
  assert.ok(
    !result.sources.some((name) => name.includes('react-day-picker')),
    'Button-only entry pulled in calendar code',
  )
  assert.ok(
    !result.sources.some((name) => name.endsWith('/contracts/src/personal.ts')),
    'unused personal schemas entered the button bundle',
  )
  assert.match(
    result.css,
    /--color-(?:primary|background)/,
    'explicit design-token CSS must survive tree shaking',
  )
})

test('a public Calendar consumer retains its date library and component implementation', () => {
  const result = build(
    "import { Calendar } from '@devon/ui'",
    "React.createElement(Calendar, { locale: 'en', onSelect() {}, label: 'Example calendar' })",
  )
  assert.ok(result.sources.some((name) => name.includes('react-day-picker')))
  assert.ok(result.sources.some((name) => name.endsWith('/ui/src/primitives/date-picker.tsx')))
  assert.match(result.css, /--color-(?:primary|background)/)
})

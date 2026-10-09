import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const checker = fileURLToPath(new URL('../../agentic/scripts/check-i18n.mjs', import.meta.url))

function check(source) {
  const directory = mkdtempSync(join(tmpdir(), 'devon-i18n-gate-'))
  try {
    mkdirSync(join(directory, 'agentic'))
    mkdirSync(join(directory, 'src'))
    mkdirSync(join(directory, 'messages'))
    writeFileSync(
      join(directory, 'agentic/i18n.config.json'),
      JSON.stringify({
        src: 'src',
        messages: 'messages',
        modules: 'messages/modules',
        locales: ['en', 'uz-Latn'],
      }),
    )
    for (const locale of ['en', 'uz-Latn']) {
      const messages = JSON.stringify({ fixture: { saved: 'Saved' } })
      writeFileSync(join(directory, `messages/${locale}.json`), messages)
      writeFileSync(join(directory, `messages/${locale}.generated.json`), messages)
    }
    writeFileSync(join(directory, 'src/view.tsx'), source)
    const result = spawnSync(process.execPath, [checker], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    assert.equal(result.error, undefined)
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'devon-i18n-gate-'))
    rmSync(directory, { recursive: true, force: true })
  }
}

test('i18n gate treats a nested JSX conditional as code, not visible text', () => {
  const result = check(`export function View() {
    return <section>{pending ? (<Loading />) : query.isError ? (<Error />) : (<p>{t('fixture.saved')}</p>)}</section>
  }`)
  assert.equal(result.status, 0, result.output)
})

test('i18n gate treats Promise callback types as TypeScript, not visible text', () => {
  const result = check(`type Props = { onSave: (input: string) => Promise<void> }
    export function View() { return <p>{t('fixture.saved')}</p> }`)
  assert.equal(result.status, 0, result.output)
})

test('i18n gate ignores markup inside a code string and a source comment', () => {
  const result = check(`const code = '<button>Save changes</button>'
    // <p>This is a source comment</p>
    export function View() { return <p>{t('fixture.saved')}</p> }`)
  assert.equal(result.status, 0, result.output)
})

test('i18n gate still refuses actual untranslated Latin and Cyrillic JSX text', () => {
  for (const text of ['Save the draft', 'Сохранить черновик']) {
    const result = check(`export function View() { return <button>${text}</button> }`)
    assert.equal(result.status, 1, result.output)
    assert.ok(result.output.includes(text), result.output)
    assert.match(result.output, /hard-coded UI strings/)
  }
})

test('i18n gate still refuses an unknown translation key', () => {
  const result = check(`export function View() { return <p>{t('fixture.missing')}</p> }`)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /fixture\.missing/)
})

test('i18n gate checks rendered entities, preserving punctuation and refusing encoded words', () => {
  const punctuation = check(
    `export function View() { return <p>&quot;{name}&quot; &larr; {t('fixture.saved')}</p> }`,
  )
  assert.equal(punctuation.status, 0, punctuation.output)
  const word = check(`export function View() { return <p>&#83;&#97;&#118;&#101;</p> }`)
  assert.equal(word.status, 1, word.output)
  assert.match(word.output, /Save/)
})

test('i18n gate honors inherited translate=no only on marked protocol examples', () => {
  const result = check(
    `export function View() { return <section><code translate="no">/start <em>field:</em></code><p>{t('fixture.saved')}</p></section> }`,
  )
  assert.equal(result.status, 0, result.output)
  const ordinary = check(
    `export function View() { return <section><code translate="no">/start</code><p>Save changes</p></section> }`,
  )
  assert.equal(ordinary.status, 1, ordinary.output)
  assert.match(ordinary.output, /Save changes/)
  const unmarkedCode = check(`export function View() { return <code>Save changes</code> }`)
  assert.equal(unmarkedCode.status, 1, unmarkedCode.output)
})

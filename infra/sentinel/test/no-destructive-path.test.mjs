import test from 'node:test'
import assert from 'node:assert/strict'
import { checkNoDestructivePath, checkDestructiveFileContainsCapability } from './lib/grep-source.mjs'

// ADR-011 (EPIC-000): "no destructive verb anywhere in src/". ADR-014 (EPIC-013) narrows this, on
// purpose, to "destructive verbs exist in exactly one file, wipe-executor.mjs, and nowhere else" --
// both halves are asserted below, so narrowing the guarantee is itself a tested, visible decision
// rather than a quiet weakening.
const DESTRUCTIVE_FILE = 'wipe-executor.mjs'

test('no destructive verb appears anywhere in the running service source except wipe-executor.mjs (ADR-014)', () => {
  const result = checkNoDestructivePath({ excludeFiles: [DESTRUCTIVE_FILE] })
  assert.ok(result.filesChecked > 0, 'expected to check at least one source file')
  assert.deepEqual(
    result.hits,
    [],
    `found banned verb(s) outside ${DESTRUCTIVE_FILE}: ${JSON.stringify(result.hits, null, 2)}`,
  )
})

test('wipe-executor.mjs exists and is the file that actually contains the wipe capability', () => {
  const result = checkDestructiveFileContainsCapability(DESTRUCTIVE_FILE)
  assert.ok(result.found, `expected src/${DESTRUCTIVE_FILE} to exist`)
  assert.ok(
    result.hasCapability,
    `expected src/${DESTRUCTIVE_FILE} to actually contain a destructive verb -- an empty or ` +
      'renamed file here would make the exclusion above vacuous',
  )
})

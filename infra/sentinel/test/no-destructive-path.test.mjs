import test from 'node:test'
import assert from 'node:assert/strict'
import { checkNoDestructivePath } from './lib/grep-source.mjs'

test('no destructive verb appears anywhere in the running service source (ADR-011)', () => {
  const result = checkNoDestructivePath()
  assert.ok(result.filesChecked > 0, 'expected to check at least one source file')
  assert.deepEqual(result.hits, [], `found banned verb(s) in src/: ${JSON.stringify(result.hits, null, 2)}`)
})

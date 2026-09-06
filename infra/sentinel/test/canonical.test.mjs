import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from '../src/canonical.mjs'

test('sorts keys ascending regardless of insertion order', () => {
  const a = canonicalJson({ v: 1, command: 'noop', nonce: 'abc', issued_at: '2026-09-06T10:00:00.000Z' })
  const b = canonicalJson({ issued_at: '2026-09-06T10:00:00.000Z', nonce: 'abc', v: 1, command: 'noop' })
  assert.equal(a, b)
  assert.equal(a, '{"command":"noop","issued_at":"2026-09-06T10:00:00.000Z","nonce":"abc","v":1}')
})

test('produces no whitespace', () => {
  const s = canonicalJson({ v: 1, command: 'noop', nonce: 'x', issued_at: 'y' })
  assert.equal(/\s/.test(s), false)
})

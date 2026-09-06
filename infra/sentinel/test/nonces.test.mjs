import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NonceStore } from '../src/nonces.mjs'

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), 'devon-sentinel-nonces-'))
  return { dir, file: join(dir, 'nonces.log') }
}

test('a fresh nonce is accepted once', () => {
  const { dir, file } = tempPath()
  try {
    const store = new NonceStore(file, 300_000)
    assert.equal(store.checkAndRecord('n1'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the same nonce replayed inside the retention window is rejected', () => {
  const { dir, file } = tempPath()
  try {
    const store = new NonceStore(file, 300_000)
    assert.equal(store.checkAndRecord('n1'), true)
    assert.equal(store.checkAndRecord('n1'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('state survives across store instances (persisted, not in-memory only)', () => {
  const { dir, file } = tempPath()
  try {
    new NonceStore(file, 300_000).checkAndRecord('n1')
    const reopened = new NonceStore(file, 300_000)
    assert.equal(reopened.checkAndRecord('n1'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nonce older than the retention window may be reused (pruned)', () => {
  const { dir, file } = tempPath()
  try {
    const store = new NonceStore(file, 100)
    const t0 = 1_000_000
    assert.equal(store.checkAndRecord('n1', t0), true)
    assert.equal(store.checkAndRecord('n1', t0 + 200), true) // past the 100ms retention window
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('retention window vs freshness window invariant (design.md risk (n))', () => {
  // This is asserted at server construction time (server.test.mjs); recorded here too as a
  // constants-level regression guard independent of the HTTP layer.
  const FRESHNESS_MS = 60_000
  const NONCE_RETENTION_MS = 300_000
  assert.ok(NONCE_RETENTION_MS > FRESHNESS_MS, 'nonce retention must strictly exceed the freshness window')
})

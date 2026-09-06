import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, DEFAULTS } from '../src/config.mjs'

test('throws when no public key is configured anywhere', () => {
  assert.throws(() => loadConfig({}), /No public key configured/)
})

test('reads the public key and overrides from a conf file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devon-sentinel-config-'))
  const confPath = join(dir, 'sentinel.conf')
  try {
    writeFileSync(
      confPath,
      ['# comment', '', 'public_key=abc123', 'port=9999', 'freshness_ms=1000', 'nonce_retention_ms=5000'].join('\n'),
    )
    const config = loadConfig({ SENTINEL_CONFIG_PATH: confPath })
    assert.equal(config.publicKeyB64, 'abc123')
    assert.equal(config.port, 9999)
    assert.equal(config.freshnessMs, 1000)
    assert.equal(config.nonceRetentionMs, 5000)
    assert.equal(config.host, DEFAULTS.host)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SENTINEL_PUBLIC_KEY env var works without any conf file', () => {
  const config = loadConfig({ SENTINEL_PUBLIC_KEY: 'env-key', SENTINEL_CONFIG_PATH: '/does/not/exist.conf' })
  assert.equal(config.publicKeyB64, 'env-key')
})

test('the command allow-list is always exactly ["noop"], regardless of conf-file content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devon-sentinel-config-'))
  const confPath = join(dir, 'sentinel.conf')
  try {
    // Even if an operator tried to add commands via the conf file, loadConfig ignores that field --
    // the allow-list is fixed in code (config.mjs, server.mjs), per ADR-011.
    writeFileSync(confPath, ['public_key=abc123', 'allowed_commands=noop,wipe,pause'].join('\n'))
    const config = loadConfig({ SENTINEL_CONFIG_PATH: confPath })
    assert.deepEqual(config.allowedCommands, ['noop'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('env vars take priority over the conf file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devon-sentinel-config-'))
  const confPath = join(dir, 'sentinel.conf')
  try {
    writeFileSync(confPath, ['public_key=from-file', 'port=1111'].join('\n'))
    const config = loadConfig({ SENTINEL_CONFIG_PATH: confPath, SENTINEL_PUBLIC_KEY: 'from-env', SENTINEL_PORT: '2222' })
    assert.equal(config.publicKeyB64, 'from-env')
    assert.equal(config.port, 2222)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

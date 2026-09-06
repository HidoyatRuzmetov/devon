import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { createSentinel } from '../src/server.mjs'
import { canonicalJson } from '../src/canonical.mjs'
import { signMessage, privateKeyFromRaw } from '../src/keys.mjs'
import { postCommand, getHealthz } from '../scripts/client.mjs'

function makeConfig(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'devon-sentinel-test-'))
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  return {
    dir,
    priv: privateKeyFromRaw(priv.x, priv.d),
    config: {
      host: '127.0.0.1',
      port: 0,
      publicKeyB64: pub.x,
      freshnessMs: 60_000,
      nonceRetentionMs: 300_000,
      maxBodyBytes: 4096,
      allowedCommands: Object.freeze(['noop']),
      logPath: join(dir, 'sentinel.log'),
      nonceStorePath: join(dir, 'nonces.log'),
      ...overrides,
    },
  }
}

async function withServer(overrides, fn) {
  const { dir, priv, config } = makeConfig(overrides)
  const { server } = createSentinel(config)
  await new Promise((resolve) => server.listen({ host: config.host, port: config.port }, resolve))
  const { port, address } = server.address()
  try {
    await fn({ port, address, priv, config })
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function sign(priv, command, fieldOverrides = {}) {
  const fields = {
    v: 1,
    command,
    nonce: fieldOverrides.nonce ?? randomBytes(32).toString('hex'),
    issued_at: fieldOverrides.issued_at ?? new Date().toISOString(),
  }
  const sig = signMessage(priv, canonicalJson(fields))
  return { ...fields, sig }
}

test('refuses to construct with a non-loopback host', () => {
  const { config } = makeConfig({ host: '0.0.0.0' })
  assert.throws(() => createSentinel(config), /127\.0\.0\.1/)
})

test('refuses to construct when nonce retention does not exceed freshness (risk (n))', () => {
  const { config } = makeConfig({ freshnessMs: 60_000, nonceRetentionMs: 60_000 })
  assert.throws(() => createSentinel(config), /nonce_retention_ms/)
})

test('GET /healthz reports ok and the noop-only command list', async () => {
  await withServer({}, async ({ port }) => {
    const res = await getHealthz({ port })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true, commands: ['noop'] })
  })
})

test('binds to 127.0.0.1, never 0.0.0.0 (AC-15)', async () => {
  await withServer({}, async ({ address, config }) => {
    assert.equal(address, '127.0.0.1')
    assert.equal(config.host, '127.0.0.1')
  })
})

test('a valid signed noop is accepted (200, ok:true)', async () => {
  await withServer({}, async ({ port, priv }) => {
    const res = await postCommand({ port, body: sign(priv, 'noop') })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.command, 'noop')
  })
})

test('break attempt: unsigned command (no sig field) is rejected as malformed', async () => {
  await withServer({}, async ({ port }) => {
    const body = { v: 1, command: 'noop', nonce: randomBytes(32).toString('hex'), issued_at: new Date().toISOString() }
    const res = await postCommand({ port, body })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'malformed')
  })
})

test('break attempt: empty-string sig is rejected as malformed', async () => {
  await withServer({}, async ({ port }) => {
    const body = { v: 1, command: 'noop', nonce: randomBytes(32).toString('hex'), issued_at: new Date().toISOString(), sig: '' }
    const res = await postCommand({ port, body })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'malformed')
  })
})

test('break attempt: wrong-key signature is rejected as bad_signature', async () => {
  await withServer({}, async ({ port }) => {
    const other = generateKeyPairSync('ed25519')
    const otherJwk = other.privateKey.export({ format: 'jwk' })
    const otherPriv = privateKeyFromRaw(otherJwk.x, otherJwk.d)
    const res = await postCommand({ port, body: sign(otherPriv, 'noop') })
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'bad_signature')
  })
})

test('break attempt: tampered command after signing is rejected as bad_signature', async () => {
  await withServer({}, async ({ port, priv }) => {
    const signed = sign(priv, 'noop')
    const res = await postCommand({ port, body: { ...signed, command: 'noop-but-different' } })
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'bad_signature')
  })
})

test('break attempt: replay of an already-accepted command is rejected', async () => {
  await withServer({}, async ({ port, priv }) => {
    const signed = sign(priv, 'noop')
    const first = await postCommand({ port, body: signed })
    assert.equal(first.status, 200)
    const replay = await postCommand({ port, body: signed })
    assert.equal(replay.status, 401)
    assert.equal(replay.body.error, 'replay')
  })
})

test('an expired issued_at (older than the freshness window) is rejected', async () => {
  await withServer({ freshnessMs: 1000 }, async ({ port, priv }) => {
    const stale = new Date(Date.now() - 60_000).toISOString()
    const res = await postCommand({ port, body: sign(priv, 'noop', { issued_at: stale }) })
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'expired')
  })
})

test('an issued_at far in the future is also rejected (freshness is |now - issued_at|)', async () => {
  await withServer({ freshnessMs: 1000 }, async ({ port, priv }) => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const res = await postCommand({ port, body: sign(priv, 'noop', { issued_at: future }) })
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'expired')
  })
})

test('an unknown command (not on the allow-list) is rejected even with a valid signature', async () => {
  await withServer({}, async ({ port, priv }) => {
    const res = await postCommand({ port, body: sign(priv, 'wipe') })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'unknown_command')
  })
})

test('a body larger than max_body_bytes is rejected with 413', async () => {
  await withServer({ maxBodyBytes: 64 }, async ({ port, priv }) => {
    const signed = sign(priv, 'noop')
    const res = await postCommand({ port, body: { ...signed, padding: 'x'.repeat(500) } })
    assert.equal(res.status, 413)
    assert.equal(res.body.error, 'too_large')
  })
})

test('malformed JSON body is rejected with 400', async () => {
  await withServer({}, async ({ port }) => {
    const res = await new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        const raw = '{not json'
        socket.write(
          `POST /command HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${raw.length}\r\nConnection: close\r\n\r\n${raw}`,
        )
      })
      let data = ''
      socket.on('data', (d) => (data += d.toString()))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    assert.match(res, /^HTTP\/1\.1 400/)
    assert.match(res, /malformed/)
  })
})

test('an unrecognised route/method is rejected with 404', async () => {
  await withServer({}, async ({ port, priv }) => {
    const res = await postCommand({ port, path: '/nope', body: sign(priv, 'noop') })
    assert.equal(res.status, 404)
  })
})

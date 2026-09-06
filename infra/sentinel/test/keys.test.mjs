import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { publicKeyFromRaw, privateKeyFromRaw, signMessage, verifySignature } from '../src/keys.mjs'

function makePair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubJwk = publicKey.export({ format: 'jwk' })
  const privJwk = privateKey.export({ format: 'jwk' })
  return { pubX: pubJwk.x, privD: privJwk.d }
}

test('a message signed by the matching private key verifies against the public key', () => {
  const { pubX, privD } = makePair()
  const pub = publicKeyFromRaw(pubX)
  const priv = privateKeyFromRaw(pubX, privD)
  const sig = signMessage(priv, 'hello sentinel')
  assert.equal(verifySignature(pub, 'hello sentinel', sig), true)
})

test('a signature from a different keypair does not verify (the "wrong key" break attempt)', () => {
  const a = makePair()
  const b = makePair()
  const pubA = publicKeyFromRaw(a.pubX)
  const privB = privateKeyFromRaw(b.pubX, b.privD)
  const sig = signMessage(privB, 'hello sentinel')
  assert.equal(verifySignature(pubA, 'hello sentinel', sig), false)
})

test('a tampered message does not verify', () => {
  const { pubX, privD } = makePair()
  const pub = publicKeyFromRaw(pubX)
  const priv = privateKeyFromRaw(pubX, privD)
  const sig = signMessage(priv, 'original message')
  assert.equal(verifySignature(pub, 'tampered message', sig), false)
})

test('garbage / empty signature strings do not verify or throw', () => {
  const { pubX } = makePair()
  const pub = publicKeyFromRaw(pubX)
  assert.equal(verifySignature(pub, 'x', ''), false)
  assert.equal(verifySignature(pub, 'x', 'not-base64url-!!!'), false)
  assert.equal(verifySignature(pub, 'x', 'AAAA'), false)
})

test('publicKeyFromRaw rejects a key that is not 32 raw bytes', () => {
  assert.throws(() => publicKeyFromRaw(Buffer.from('too short').toString('base64url')))
})

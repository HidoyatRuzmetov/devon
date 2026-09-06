// ed25519 key handling via Node's built-in crypto only (ADR-011: dependency-free). Keys are carried
// as base64url-encoded raw 32-byte values (JWK 'x'/'d' members), never as PEM/DER, so the on-disk
// config format (infra/sentinel/sentinel.conf.example) stays a flat `key=value` file with no
// multi-line blocks to get wrong.
import { createPublicKey, createPrivateKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'

function b64urlToBuffer(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}

function bufferToB64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** @param {string} rawB64url base64url of the 32 raw ed25519 public-key bytes */
export function publicKeyFromRaw(rawB64url) {
  const raw = b64urlToBuffer(rawB64url)
  if (raw.length !== 32) {
    throw new Error(`ed25519 public key must decode to 32 raw bytes, got ${raw.length}`)
  }
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bufferToB64url(raw) }, format: 'jwk' })
}

/** @param {string} xB64url raw public bytes  @param {string} dB64url raw private bytes */
export function privateKeyFromRaw(xB64url, dB64url) {
  return createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: xB64url, d: dB64url }, format: 'jwk' })
}

export function verifySignature(publicKeyObject, message, sigB64url) {
  let sig
  try {
    sig = b64urlToBuffer(sigB64url)
  } catch {
    return false
  }
  try {
    return cryptoVerify(null, Buffer.from(message, 'utf8'), publicKeyObject, sig)
  } catch {
    // A malformed key/signature combination throws rather than returning false in Node's crypto --
    // from the caller's point of view that is still just "does not verify".
    return false
  }
}

export function signMessage(privateKeyObject, message) {
  const sig = cryptoSign(null, Buffer.from(message, 'utf8'), privateKeyObject)
  return bufferToB64url(sig)
}

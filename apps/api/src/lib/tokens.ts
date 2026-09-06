// Opaque bearer tokens (setup URL token, session cookie value, CSRF companion cookie value). The raw
// value exists only in the URL/cookie the client holds; only its SHA-256 hash is ever written to
// Postgres (design.md §2.2 `app.sessions.token_hash`, `app.setup_tokens.token_hash`), so a database
// leak alone never yields a usable credential.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/** 32 bytes = 256 bits of entropy, base64url-encoded (URL-safe, no padding) -- comfortably over the
 * "under 128 bits of entropy" disproof line in AC-12. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Constant-time comparison for anything derived from a secret token, so a timing side-channel never
 * lets an attacker learn a hash byte-by-byte. Both inputs are hex digests of equal, fixed length. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

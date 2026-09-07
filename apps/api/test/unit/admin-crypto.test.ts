// Pure, DB-free coverage for `modules/admin/crypto.ts` (the sentinel HMAC key's at-rest encryption).
import { describe, expect, it } from 'vitest'
import { encryptSecret, decryptSecret } from '../../src/modules/admin/crypto.js'

const SECRET = 'test-csrf-secret-value'

describe('admin crypto (AES-256-GCM over a CSRF_SECRET-derived key)', () => {
  it('round-trips an arbitrary plaintext', () => {
    const plain = 'a'.repeat(64) // a 32-byte hex key, the real shape this protects
    const encrypted = encryptSecret(plain, SECRET)
    expect(encrypted).not.toBe(plain)
    expect(decryptSecret(encrypted, SECRET)).toBe(plain)
  })

  it('never produces the same ciphertext twice for the same plaintext (random IV)', () => {
    const a = encryptSecret('same-plaintext', SECRET)
    const b = encryptSecret('same-plaintext', SECRET)
    expect(a).not.toBe(b)
  })

  it('fails closed on a wrong key (auth tag mismatch), never returning wrong plaintext', () => {
    const encrypted = encryptSecret('secret-value', SECRET)
    expect(() => decryptSecret(encrypted, 'a-completely-different-secret')).toThrow()
  })

  it('throws on a malformed encoded value rather than returning garbage', () => {
    expect(() => decryptSecret('not-the-right-shape', SECRET)).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/lib/password.js'

describe('password hashing (argon2id, TECH-SPEC §1)', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('Str0ngExampleValue123')
    expect(await verifyPassword(hash, 'Str0ngExampleValue123')).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('Str0ngExampleValue123')
    expect(await verifyPassword(hash, 'wrong-password-example')).toBe(false)
  })

  it('never stores the plaintext in the hash output', async () => {
    const plain = 'Str0ngExampleValue123'
    const hash = await hashPassword(plain)
    expect(hash).not.toContain(plain)
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('fails closed on a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false)
  })

  it('salts every hash differently even for the same password', async () => {
    const a = await hashPassword('Str0ngExampleValue123')
    const b = await hashPassword('Str0ngExampleValue123')
    expect(a).not.toBe(b)
  })
})

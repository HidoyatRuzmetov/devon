import { describe, expect, it } from 'vitest'
import { generateToken, sha256Hex, hashesEqual } from '../../src/lib/tokens.js'

describe('tokens (AC-12: "under 128 bits of entropy" disproof)', () => {
  it('generates at least 256 bits of entropy per token', () => {
    const token = generateToken()
    // base64url encodes 6 bits/char; 32 raw bytes -> 43 chars (no padding).
    expect(token.length).toBeGreaterThanOrEqual(43)
  })

  it('never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken()))
    expect(tokens.size).toBe(1000)
  })

  it('hashes deterministically', () => {
    const token = generateToken()
    expect(sha256Hex(token)).toBe(sha256Hex(token))
  })

  it('hashesEqual is true only for identical hashes', () => {
    const a = sha256Hex('one')
    const b = sha256Hex('one')
    const c = sha256Hex('two')
    expect(hashesEqual(a, b)).toBe(true)
    expect(hashesEqual(a, c)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { redactAuditPayload } from '../../src/audit.js'

describe('redactAuditPayload (H1.11)', () => {
  it('redacts a secret-tier field by its snake_case column name', () => {
    const out = redactAuditPayload({ password_hash: 'abc123', given_name: 'Aziz' }) as Record<
      string,
      unknown
    >
    expect(out['password_hash']).toBe('[redacted]')
    expect(out['given_name']).toBe('Aziz')
  })

  it('redacts nested objects', () => {
    const out = redactAuditPayload({ user: { password_hash: 'abc', login: 'aziz' } }) as {
      user: Record<string, unknown>
    }
    expect(out.user['password_hash']).toBe('[redacted]')
    expect(out.user['login']).toBe('aziz')
  })

  it('redacts inside arrays', () => {
    const out = redactAuditPayload([{ password_hash: 'abc' }, { given_name: 'Aziz' }]) as Array<
      Record<string, unknown>
    >
    expect(out[0]!['password_hash']).toBe('[redacted]')
    expect(out[1]!['given_name']).toBe('Aziz')
  })

  it('passes primitives and null through unchanged', () => {
    expect(redactAuditPayload(null)).toBeNull()
    expect(redactAuditPayload(undefined)).toBeUndefined()
    expect(redactAuditPayload('plain string')).toBe('plain string')
    expect(redactAuditPayload(42)).toBe(42)
  })
})

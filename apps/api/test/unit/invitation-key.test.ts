import { describe, expect, it } from 'vitest'
import { normalizeInvitationKey } from '@devon/contracts'
import { joinBodySchema, joinKeyParamsSchema } from '../../src/modules/departments/schemas.js'

describe('invitation text boundary', () => {
  it.each([
    'ABCD2345EFGH',
    ' abcd2345efgh\n',
    '%41BCD2345EFGH',
    'key=ABCD2345EFGH',
    'https://portal.example.invalid/join?key=ABCD2345EFGH',
    ' /join?key=%41BCD2345EFGH\n',
  ])('normalizes supported copied input %s without changing the password', (key) => {
    expect(joinBodySchema.parse({ key, password: 'CaseSensitiveExample' })).toEqual({
      key: 'ABCD2345EFGH',
      password: 'CaseSensitiveExample',
    })
  })
  it.each([
    '',
    '%',
    'javascript:alert(1)',
    'https://viewer:Example@portal.invalid/join?key=ABCD2345EFGH',
    'https://portal.invalid/admin?key=ABCD2345EFGH',
  ])('refuses unsupported input %s', (key) => {
    expect(joinBodySchema.safeParse({ key, password: 'Example' }).success).toBe(false)
  })
  it('normalizes a preview token consistently and does not expose query passwords', () => {
    expect(joinKeyParamsSchema.parse({ key: ' abcd2345efgh ' })).toEqual({ key: 'ABCD2345EFGH' })
    expect(normalizeInvitationKey('/join?key=ABCD2345EFGH&password=do-not-use')).toBe(
      'ABCD2345EFGH',
    )
  })
})

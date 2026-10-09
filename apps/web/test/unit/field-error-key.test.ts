import { describe, expect, it } from 'vitest'
import { fieldErrorKey } from '../../src/features/fields/error-key.js'

describe('custom-field refusal feedback', () => {
  it('retains translated domain refusals', () => {
    expect(fieldErrorKey('personal_data')).toBe('fields.error.personal_data')
    expect(fieldErrorKey('duplicate_option')).toBe('fields.error.duplicate_option')
  })

  it.each(['invalid_type', 'too_big', 'unrecognized_keys'])(
    'uses operation recovery copy for an untranslated wire error %s',
    (code) => expect(fieldErrorKey(code)).toBeNull(),
  )
})

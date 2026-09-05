import { describe, expect, it } from 'vitest'
import {
  fieldsOfTier,
  SECRET_USER_FIELDS,
  SECRET_USER_FIELDS_SQL,
  USER_FIELD_TIER,
  USER_FIELD_TIER_SQL,
} from '../../src/tiers.js'

describe('USER_FIELD_TIER', () => {
  it('marks passwordHash as secret and nothing else', () => {
    expect(fieldsOfTier('secret')).toEqual(['passwordHash'])
  })

  it('marks email as restricted (design §3.2)', () => {
    expect(USER_FIELD_TIER['email']).toBe('restricted')
  })

  it('marks names and avatar as public', () => {
    for (const field of ['givenName', 'familyName', 'patronymic', 'title', 'avatarKey']) {
      expect(USER_FIELD_TIER[field]).toBe('public')
    }
  })

  it('marks login/status/role as internal, not public', () => {
    for (const field of ['login', 'status', 'role']) {
      expect(USER_FIELD_TIER[field]).toBe('internal')
    }
  })

  it('SECRET_USER_FIELDS and the snake_case mirror agree', () => {
    expect(SECRET_USER_FIELDS).toEqual(['passwordHash'])
    expect(SECRET_USER_FIELDS_SQL).toEqual(['password_hash'])
  })

  it('the snake_case mirror covers every camelCase key', () => {
    expect(Object.keys(USER_FIELD_TIER_SQL)).toHaveLength(Object.keys(USER_FIELD_TIER).length)
    expect(USER_FIELD_TIER_SQL['password_hash']).toBe('secret')
    expect(USER_FIELD_TIER_SQL['given_name']).toBe('public')
  })
})

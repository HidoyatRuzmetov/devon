import { describe, expect, it } from 'vitest'
import {
  FIELD_TIERS,
  fieldsUpToTier,
  isVisibleAtTier,
  secretFields,
  type FieldTier,
} from '../../src/field-tiers.js'

// A throwaway map shaped like a real one (e.g. `USER_FIELD_TIER` in `packages/db/src/tiers.ts`),
// without importing it -- this package has no runtime dependency on `@devon/db` (design.md §1.1/§1.2).
const SAMPLE_TIERS: Readonly<Record<string, FieldTier>> = Object.freeze({
  givenName: 'public',
  login: 'internal',
  email: 'restricted',
  passwordHash: 'secret',
})

describe('FIELD_TIERS', () => {
  it('is the frozen four-tier vocabulary from TECH-SPEC §3.2', () => {
    expect(FIELD_TIERS).toEqual(['public', 'internal', 'restricted', 'secret'])
  })
})

describe('fieldsUpToTier', () => {
  it('at upTo=public, returns only public fields', () => {
    expect(fieldsUpToTier(SAMPLE_TIERS, 'public')).toEqual(['givenName'])
  })

  it('at upTo=internal, returns public and internal fields', () => {
    expect(fieldsUpToTier(SAMPLE_TIERS, 'internal').sort()).toEqual(['givenName', 'login'].sort())
  })

  it('at upTo=restricted, returns public, internal and restricted fields -- never secret', () => {
    expect(fieldsUpToTier(SAMPLE_TIERS, 'restricted').sort()).toEqual(
      ['givenName', 'login', 'email'].sort(),
    )
  })

  it('never returns a secret field, at any readable tier', () => {
    for (const upTo of ['public', 'internal', 'restricted'] as const) {
      expect(fieldsUpToTier(SAMPLE_TIERS, upTo)).not.toContain('passwordHash')
    }
  })
})

describe('isVisibleAtTier', () => {
  it('public is visible at every readable clearance', () => {
    for (const upTo of ['public', 'internal', 'restricted'] as const) {
      expect(isVisibleAtTier('public', upTo)).toBe(true)
    }
  })

  it('restricted is not visible at public or internal clearance', () => {
    expect(isVisibleAtTier('restricted', 'public')).toBe(false)
    expect(isVisibleAtTier('restricted', 'internal')).toBe(false)
    expect(isVisibleAtTier('restricted', 'restricted')).toBe(true)
  })

  it('secret is visible at no readable clearance', () => {
    for (const upTo of ['public', 'internal', 'restricted'] as const) {
      expect(isVisibleAtTier('secret', upTo)).toBe(false)
    }
  })
})

describe('secretFields', () => {
  it('names exactly the fields tiered secret', () => {
    expect(secretFields(SAMPLE_TIERS)).toEqual(['passwordHash'])
  })

  it('is empty when a map has no secret fields', () => {
    expect(secretFields({ givenName: 'public', login: 'internal' })).toEqual([])
  })
})

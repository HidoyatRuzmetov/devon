// `schemas.ts`'s `AI_FEATURE_IDS` is a local literal tuple, not an import of `@devon/ai`'s own
// `AiFeature` union (`schemas.ts`'s header comment explains why: a real Zod enum for the route param,
// not a runtime cast) -- this test is the guard rail that keeps the two lists from silently drifting
// apart as features are added.
import { describe, expect, it } from 'vitest'
import { AI_FEATURES } from '@devon/ai'
import { AI_FEATURE_IDS } from '../../../src/modules/ai/schemas.js'

describe('AI_FEATURE_IDS parity with @devon/ai', () => {
  it("has exactly the same members as @devon/ai's AI_FEATURES, in any order", () => {
    expect(new Set(AI_FEATURE_IDS)).toEqual(new Set(AI_FEATURES))
    expect(AI_FEATURE_IDS.length).toBe(AI_FEATURES.length)
  })
})

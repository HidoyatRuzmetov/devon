// SPEC §7 -- the Imkoniyatlar registry. Two things are worth a test here, and they are the two
// things that would otherwise rot silently.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FEATURES,
  FEATURE_KEYS,
  allFeaturesOn,
  isFeatureKey,
  resolveFeatures,
} from '../../src/features.js'

describe('the feature registry', () => {
  it('every key has a spec, and every spec agrees with its key', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURES[key], key).toBeDefined()
      expect(FEATURES[key].key).toBe(key)
      expect(FEATURES[key].labelKey).toBe(`departments.features.${key}.label`)
      expect(FEATURES[key].descriptionKey).toBe(`departments.features.${key}.description`)
    }
  })

  it('everything v1.0 did not already have ships off (SPEC §7)', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURES[key].defaultEnabled, `${key} must default to off`).toBe(false)
    }
  })
})

describe('resolveFeatures', () => {
  it('fills every key from the defaults when nothing is stored', () => {
    const resolved = resolveFeatures({})
    expect(Object.keys(resolved).sort()).toEqual([...FEATURE_KEYS].sort())
    expect(Object.values(resolved).every((v) => v === false)).toBe(true)
  })

  it('lets a stored override win', () => {
    expect(resolveFeatures({ estimates: true }).estimates).toBe(true)
    expect(resolveFeatures({ estimates: true }).workload).toBe(false)
  })

  it('ignores a key the product no longer has, and a value that is not a boolean', () => {
    // A switch removed from the registry must not linger as a truthy value nobody can see, and a
    // string must never be coerced into a capability being on.
    const resolved = resolveFeatures({ gantt_charts: true, estimates: 'yes', workload: 1 })
    expect('gantt_charts' in resolved).toBe(false)
    expect(resolved.estimates).toBe(false)
    expect(resolved.workload).toBe(false)
  })

  it('survives every shape a jsonb column can actually hand back', () => {
    for (const stored of [null, undefined, 'not an object', 42, [], [1, 2]]) {
      expect(Object.keys(resolveFeatures(stored)).sort()).toEqual([...FEATURE_KEYS].sort())
    }
  })

  it('allFeaturesOn turns on exactly the registry keys', () => {
    const all = allFeaturesOn()
    expect(Object.keys(all).sort()).toEqual([...FEATURE_KEYS].sort())
    expect(Object.values(all).every(Boolean)).toBe(true)
  })

  it('isFeatureKey is a real guard', () => {
    expect(isFeatureKey('estimates')).toBe(true)
    expect(isFeatureKey('gantt_charts')).toBe(false)
  })
})

describe('the demo seed mirrors the registry', () => {
  // `@devon/db` deliberately does not depend on `@devon/contracts` (the same one-way rule that makes
  // `packages/db/src/context.ts` re-declare the `Role` union), so `core.ts`'s demo department writes
  // its own literal switch map. That mirror is exactly the kind of thing that drifts the first time
  // a switch is added -- so it is checked here, by reading the file, rather than trusted.
  const seedFile = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'db',
    'src',
    'seed',
    'modules',
    'core.ts',
  )

  it('DEMO_FEATURES lists every registry key, all on', () => {
    const source = readFileSync(seedFile, 'utf8')
    const block = /const DEMO_FEATURES[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(source)
    expect(block, 'DEMO_FEATURES not found in packages/db/src/seed/modules/core.ts').not.toBeNull()
    const entries = [...block![1]!.matchAll(/(\w+):\s*(true|false)/g)]
    const seeded = Object.fromEntries(entries.map((m) => [m[1]!, m[2] === 'true']))
    expect(Object.keys(seeded).sort()).toEqual([...FEATURE_KEYS].sort())
    expect(Object.values(seeded).every(Boolean), 'the demo department turns every switch on').toBe(
      true,
    )
  })
})

// SPEC §7 -- "Imkoniyatlar": the department's feature switches, as one registry both sides read.
//
// ClickUp calls these ClickApps. The product reason for having them at all: a boshqarma boshligʻi
// running eight people and a boshqarma running eighty do not want the same product, and a screen full
// of estimate fields, dependency arrows and automation rules is how you lose the eight-person one.
// So everything v1.0 did not already have ships **off**, and the head turns on what their department
// actually needs. The demo department has them all on, because a demo is a tour.
//
// The defaults live here, not in the database: `app.departments.features` stores only what a head has
// explicitly flipped (`{}` is a perfectly good value), so adding a switch is a code change, never a
// migration and never a backfill. `resolveFeatures()` is the one function that merges the two, and
// both the API (`departments/repo.ts`) and the client (`useFeature()`) call it rather than
// re-implementing the merge.
//
// A switch is *not* a permission. `can()` decides who may flip it (`departments.features.edit`, which
// is head-only); this file decides whether the capability exists in this department at all. A member
// sees the list read-only, which is deliberate: "we do not use estimates here" is a fact the whole
// department benefits from being able to see.

/** Every switch key. Ordered as the settings screen lists them: data shape first, then planning,
 * then the things that act on their own. */
export const FEATURE_KEYS = [
  'custom_fields',
  'person_fields',
  'estimates',
  'workload',
  'dependencies',
  'recurring',
  'templates',
  'goals',
  'focus_list',
  'automations',
  'reminders',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export type FeatureSpec = {
  readonly key: FeatureKey
  /** i18n key for the switch's name, under `departments.features.<key>.label`. */
  readonly labelKey: string
  /** i18n key for the one sentence that says what turning it on does. */
  readonly descriptionKey: string
  /** SPEC §7: "Defaults: everything off except what v1.0 already had". */
  readonly defaultEnabled: boolean
  /** Where the switch shows up, so the settings screen can group them. */
  readonly area: 'work' | 'people' | 'planning' | 'automation'
}

export const FEATURES: Readonly<Record<FeatureKey, FeatureSpec>> = Object.freeze({
  custom_fields: {
    key: 'custom_fields',
    labelKey: 'departments.features.custom_fields.label',
    descriptionKey: 'departments.features.custom_fields.description',
    defaultEnabled: false,
    area: 'work',
  },
  person_fields: {
    key: 'person_fields',
    labelKey: 'departments.features.person_fields.label',
    descriptionKey: 'departments.features.person_fields.description',
    defaultEnabled: false,
    area: 'people',
  },
  estimates: {
    key: 'estimates',
    labelKey: 'departments.features.estimates.label',
    descriptionKey: 'departments.features.estimates.description',
    defaultEnabled: false,
    area: 'work',
  },
  workload: {
    key: 'workload',
    labelKey: 'departments.features.workload.label',
    descriptionKey: 'departments.features.workload.description',
    defaultEnabled: false,
    area: 'people',
  },
  dependencies: {
    key: 'dependencies',
    labelKey: 'departments.features.dependencies.label',
    descriptionKey: 'departments.features.dependencies.description',
    defaultEnabled: false,
    area: 'work',
  },
  recurring: {
    key: 'recurring',
    labelKey: 'departments.features.recurring.label',
    descriptionKey: 'departments.features.recurring.description',
    defaultEnabled: false,
    area: 'work',
  },
  templates: {
    key: 'templates',
    labelKey: 'departments.features.templates.label',
    descriptionKey: 'departments.features.templates.description',
    defaultEnabled: false,
    area: 'planning',
  },
  goals: {
    key: 'goals',
    labelKey: 'departments.features.goals.label',
    descriptionKey: 'departments.features.goals.description',
    defaultEnabled: false,
    area: 'planning',
  },
  focus_list: {
    key: 'focus_list',
    labelKey: 'departments.features.focus_list.label',
    descriptionKey: 'departments.features.focus_list.description',
    defaultEnabled: false,
    area: 'work',
  },
  automations: {
    key: 'automations',
    labelKey: 'departments.features.automations.label',
    descriptionKey: 'departments.features.automations.description',
    defaultEnabled: false,
    area: 'automation',
  },
  reminders: {
    key: 'reminders',
    labelKey: 'departments.features.reminders.label',
    descriptionKey: 'departments.features.reminders.description',
    defaultEnabled: false,
    area: 'automation',
  },
})

export type FeatureFlags = Record<FeatureKey, boolean>

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value)
}

/**
 * Merge a department's stored overrides onto the registry defaults. Unknown keys in the stored jsonb
 * are ignored rather than trusted (a switch removed from the product must not linger as a truthy
 * value nobody can see), and a non-boolean value falls back to the default rather than being coerced.
 */
export function resolveFeatures(stored: unknown): FeatureFlags {
  const overrides =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
  const out = {} as FeatureFlags
  for (const key of FEATURE_KEYS) {
    const raw = overrides[key]
    out[key] = typeof raw === 'boolean' ? raw : FEATURES[key].defaultEnabled
  }
  return out
}

/** Every switch on -- what the demo department seeds, and what a test that does not care about
 * gating should use. */
export function allFeaturesOn(): FeatureFlags {
  const out = {} as FeatureFlags
  for (const key of FEATURE_KEYS) out[key] = true
  return out
}

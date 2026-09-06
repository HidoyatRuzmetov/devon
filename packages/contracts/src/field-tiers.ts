// Personal-data field tiers (TECH-SPEC §3.2, I-2). The concrete tier map for a given table lives next
// to that table's schema -- e.g. `USER_FIELD_TIER` in `packages/db/src/tiers.ts`, owned by
// EPIC-000.2 -- and this item imports nothing from `@devon/db` (design.md §1.2: `contracts` carries no
// runtime dependency beyond zod, and the package graph is one-way, `contracts ← everything`).
// `@devon/contracts` ships only the tier vocabulary and a generic, table-agnostic derivation
// mechanism, so every response schema in the codebase builds its field allow-list the same way,
// regardless of which package owns the concrete map.

/** Ascending sensitivity. `public` needs no session context to read; `secret` must never leave the
 * process (no response schema, no audit payload, no log line -- design.md §3.2). */
export const FIELD_TIERS = ['public', 'internal', 'restricted', 'secret'] as const
export type FieldTier = (typeof FIELD_TIERS)[number]

const TIER_RANK: Readonly<Record<FieldTier, number>> = Object.freeze({
  public: 0,
  internal: 1,
  restricted: 2,
  secret: 3,
})

/** Every tier the tier below `secret` includes: `public` reads at `'public'`, `internal` reads at
 * `'internal'` also see `public` fields, and so on. `secret` is deliberately unreachable through this
 * helper -- see `fieldsUpToTier` below. */
export type ReadableTier = Exclude<FieldTier, 'secret'>

/**
 * Returns the field names visible at-or-below `upTo`, from a caller-supplied tier map. `secret`
 * fields are never returned, because `upTo` can never be `'secret'` (a response schema may not ask
 * for it -- design.md §3.2: "no schema anywhere includes a `secret` field name").
 *
 * An unclassified field (present as a key of `fields` typing but absent from `tiers`, or vice versa)
 * is a caller bug, not a permission decision; callers pass a `Record` covering every field, which
 * TypeScript already enforces at the call site.
 */
export function fieldsUpToTier<Field extends string>(
  tiers: Readonly<Record<Field, FieldTier>>,
  upTo: ReadableTier,
): Field[] {
  const maxRank = TIER_RANK[upTo]
  return (Object.keys(tiers) as Field[]).filter((field) => TIER_RANK[tiers[field]] <= maxRank)
}

/** True iff `tier` is visible to a reader cleared up to `upTo` (`secret` is visible to no one, at any
 * clearance, through this function). */
export function isVisibleAtTier(tier: FieldTier, upTo: ReadableTier): boolean {
  return TIER_RANK[tier] <= TIER_RANK[upTo]
}

/** Names every field classified `secret` in `tiers`. Used by response-schema tests elsewhere in the
 * codebase to assert a schema never names one of these (design.md §3.2). */
export function secretFields<Field extends string>(
  tiers: Readonly<Record<Field, FieldTier>>,
): Field[] {
  return (Object.keys(tiers) as Field[]).filter((field) => tiers[field] === 'secret')
}

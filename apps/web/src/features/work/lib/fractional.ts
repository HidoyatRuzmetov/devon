// Fractional order keys for the People board and table drag-and-drop (TECH-SPEC §5; the schema's own
// comment on `packages/db/src/schema/work.ts`'s `cards.orderKey`: "the web feature's `lib/
// fractional.ts` generates/re-balances these"). Wraps the well-tested `fractional-indexing` package
// rather than hand-rolling the digit arithmetic -- its default alphabet (no `digits` argument, so it
// falls back to `BASE_52_DIGITS`, A-Z/a-z heads) produces the exact `"a0"` first key the server's own
// `order_key` column default already uses (`packages/db/migrations/0300_work_cards.sql`), so an
// existing seeded card and a freshly drag-and-dropped one sort correctly against each other with no
// migration or backfill.
import { generateKeyBetween } from 'fractional-indexing'

/** A key that sorts strictly between `before` and `after` (either bound `null` for "start"/"end" of
 * the list). Two concurrent drags never need to touch a third card's key -- exactly the property a
 * drag-and-drop reorder needs for an optimistic update that only ever PATCHes the one card that moved. */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after)
}

/** Convenience for "insert at index `index` in this already-sorted list of keys" -- the shape every
 * drop handler actually has (a list of sibling order keys plus a target position), so call sites never
 * hand-pick `before`/`after` from the array themselves. */
export function keyForIndex(siblingKeys: readonly string[], index: number): string {
  const before = index > 0 ? (siblingKeys[index - 1] ?? null) : null
  const after = index < siblingKeys.length ? (siblingKeys[index] ?? null) : null
  return keyBetween(before, after)
}

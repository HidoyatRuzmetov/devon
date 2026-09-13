// The one thing the `fields` module exposes to another module: a card's custom-field answers keyed by
// the definition's `key`, which is exactly what `@devon/contracts`'s filter grammar needs to evaluate
// `field:<key>:<value>` (v1.1 SPEC §5, `FilterableCard.fieldValues`).
//
// It lives in its own file rather than in `service.ts` so the import in
// `apps/api/src/modules/work/index.ts` reads as what it is -- one narrow, documented dependency, the
// same shape `notifications/delivery.ts` already has on `telegram/transport.ts` -- and so nothing
// else about this module leaks across that boundary.
//
// One query for the whole department, never one per card (I-14): a filter runs over the same card
// list the route already loaded, so the values have to arrive in the same single round trip. RLS
// still decides which rows come back -- a card value is `department_child`, so every member of the
// department sees them, and a person value is never in this result at all (`subject_type = 'card'`).
import { sql } from 'drizzle-orm'
import type { Tx } from '@devon/db'
import type { FieldValue } from '@devon/contracts'

export type CardFieldValues = ReadonlyMap<string, Readonly<Record<string, FieldValue>>>

type Row = { subject_id: string; key: string; value: FieldValue }

/** `cardId -> { <field key>: answer }` for every card in the department that has at least one
 * answer. A card with no answers is simply absent, and `matchesFilterQuery` then treats every
 * `field:` clause on it as "empty" -- which is the honest reading, not a silent match. */
export async function cardFieldValues(tx: Tx, departmentId: string): Promise<CardFieldValues> {
  const rows = await tx.raw<Row>(sql`
    select v.subject_id, d.key, v.value
    from app.field_values v
    join app.field_defs d on d.id = v.def_id
    where v.department_id = ${departmentId}
      and v.subject_type = 'card'
      and d.archived_at is null
  `)

  const byCard = new Map<string, Record<string, FieldValue>>()
  for (const row of rows) {
    const entry = byCard.get(row.subject_id) ?? {}
    entry[row.key] = row.value ?? null
    byCard.set(row.subject_id, entry)
  }
  return byCard
}

/**
 * SPEC §5: "required fields block moving to done with an inline message". Returns the `key` of every
 * required, live card field this card has left empty -- empty list means the card may be finished.
 *
 * One query, and the emptiness test is the same one `isFieldValueMissing` makes in
 * `@devon/contracts`, expressed in SQL so a card with *no row at all* for a required field counts as
 * missing (a left join is the only way to see a value that was never written). `checkbox` is the one
 * type where `false` is a real answer, exactly as in the shared validator.
 */
export async function missingRequiredCardFields(
  tx: Tx,
  departmentId: string,
  cardId: string,
): Promise<string[]> {
  const rows = await tx.raw<{ key: string }>(sql`
    select d.key
    from app.field_defs d
    left join app.field_values v
      on v.def_id = d.id and v.subject_id = ${cardId}::uuid and v.subject_type = 'card'
    where d.department_id = ${departmentId}
      and d.applies_to = 'card'
      and d.archived_at is null
      and d.required = true
      and (
        v.value is null
        or v.value = 'null'::jsonb
        or (jsonb_typeof(v.value) = 'string' and btrim(v.value #>> '{}') = '')
        or (jsonb_typeof(v.value) = 'array' and jsonb_array_length(v.value) = 0)
      )
    order by d.sort, d.key
  `)
  return rows.map((r) => r.key)
}

import { sql } from 'drizzle-orm'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Tx } from '@devon/db'

export function validOrderKey(value: string): boolean {
  if (value.length > 100 || !/^[A-Za-z][0-9A-Za-z]+$/.test(value)) return false
  try {
    generateKeyBetween(value, null)
    return true
  } catch {
    return false
  }
}

/** Creates and moves share one short transaction lock. Concurrent drops resolve current sibling
 * IDs inside it, rather than trusting ranks from an old browser response. */
export async function lockCardOrder(tx: Tx, departmentId: string): Promise<void> {
  await tx.raw(
    sql`select pg_advisory_xact_lock(hashtextextended(${`work-order:${departmentId}`}, 0))`,
  )
}

export async function columnOrder(
  tx: Tx,
  departmentId: string,
  userId: string | null,
  omitId?: string,
) {
  const rows = await tx.raw<{
    id: string
    order_key: string
  }>(sql`select c.id, c.order_key from app.cards c
    where c.department_id = ${departmentId}
      and (c.assignee_user_id is not distinct from ${userId}::uuid
        ${
          userId === null
            ? sql`or (c.assignee_user_id is not null and not exists (
          select 1 from app.memberships m join app.users u on u.id = m.user_id
          where m.department_id = ${departmentId} and m.user_id = c.assignee_user_id
            and m.status = 'active' and m.deleted_at is null
            and u.deleted_at is null and u.status != 'deleted'))`
            : sql``
        })
      and c.deleted_at is null and c.status = 'active' ${omitId ? sql`and c.id != ${omitId}` : sql``}
    order by c.order_key collate "C" asc, c.created_at asc, c.id asc`)
  return rows
}

/** Old quick-added cards all received a0. Rebalance only this destination column, retaining its
 * stable order, whenever tied/invalid/overlong legacy ranks cannot express an insertion. */
export async function rankForPosition(
  tx: Tx,
  departmentId: string,
  rows: { id: string; order_key: string }[],
  index: number,
): Promise<string> {
  const before = rows[index - 1]?.order_key ?? null
  const after = rows[index]?.order_key ?? null
  try {
    if ((before !== null && !validOrderKey(before)) || (after !== null && !validOrderKey(after)))
      throw new Error('Legacy order key')
    const key = generateKeyBetween(before, after)
    if (key.length <= 100) return key
  } catch {
    // Invalid or tied neighbours from the old default; regenerate their keys below.
  }
  const keys = generateNKeysBetween(null, null, rows.length)
  if (rows.length) {
    const values = rows.map((row, i) => sql`(${row.id}::uuid, ${keys[i]}::text)`)
    await tx.raw(sql`update app.cards c set order_key = v.key
      from (values ${sql.join(values, sql`, `)}) v(id, key)
      where c.id = v.id and c.department_id = ${departmentId}`)
    tx.audit({
      action: 'work.card_order_rebalanced',
      subjectType: 'department',
      subjectId: departmentId,
      departmentId,
      after: { cardIds: rows.map((row) => row.id) },
    })
  }
  return generateKeyBetween(keys[index - 1] ?? null, keys[index] ?? null)
}

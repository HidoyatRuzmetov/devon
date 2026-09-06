// Domain event outbox helpers (MODULE-GUIDE.md "Domain events"). Mirrors `audit.ts`'s shape exactly:
// `context.ts` owns the transaction lifecycle and calls into this module to insert; this module owns
// the SQL. A row inserted here is only ever written by `tx.emit()`, inside the same transaction as the
// domain write that caused it (migrations/0007_events_outbox.sql), so an event can never exist without
// its cause having committed.
import type { PoolClient } from 'pg'

/**
 * Event type convention (documented once, enforced nowhere but code review): `'<module>.<noun>.
 * <verb-past-tense>'`, e.g. `'people.employee.hired'`, `'work.card.moved'`, `'events.meeting.
 * scheduled'` -- the module that emits an event owns its name and its payload shape; a subscriber in
 * a different module treats the payload as an untyped `unknown` it parses for itself (no shared
 * payload types package -- that would be exactly the cross-module edit this bus exists to avoid).
 */
export type OutboxEventInput = {
  type: `${string}.${string}`
  payload: unknown
  /** Defaults to the request's own department when omitted, same convention as `AuditEventInput`.
   * Pass `null` explicitly for a genuinely instance-level event (no department). */
  departmentId?: string | null
}

export type OutboxEventRecord = {
  id: string
  type: string
  payload: unknown
  departmentId: string | null
  createdAt: Date
  attempts: number
}

type ActorContext = {
  departmentId: string | null
}

export async function insertOutboxEvent(
  client: PoolClient,
  ctx: ActorContext,
  event: OutboxEventInput,
): Promise<void> {
  await client.query(
    `insert into app.outbox_events (type, payload, department_id)
     values ($1, $2, $3)`,
    [event.type, JSON.stringify(event.payload), event.departmentId ?? ctx.departmentId],
  )
}

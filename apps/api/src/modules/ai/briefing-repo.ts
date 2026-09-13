// The briefing cache's own storage (`app.ai_briefings`, migration 1900).
//
// Split out of `briefing.ts` for one reason: the job runner has to call `service.ts`'s
// `runFeatureForActor`, and `service.ts` has to write this cache when the Friday digest produces a
// briefing of its own. Keeping the SQL here -- with no import of either -- means neither file has to
// import the other, so there is no cycle to reason about at module-evaluation time.
//
// Why the table exists at all, and why the briefing is a cached result rather than a request, is
// `briefing.ts`'s header and `migrations/1900_ai_briefings.sql`.
import { sql } from 'drizzle-orm'
import type { RequestContext, Tx } from '@devon/db'
import { withContext } from '@devon/db'

export type BriefingStatus = 'queued' | 'running' | 'ready' | 'failed'

export type BriefingRow = {
  day: string
  locale: string
  status: BriefingStatus
  output: Record<string, unknown> | null
  generatedAt: string | null
  error: string | null
  latencyMs: number | null
  updatedAt: string
}

type DbRow = {
  day: string
  locale: string
  status: string
  output: Record<string, unknown> | null
  generated_at: Date | string | null
  error: string | null
  latency_ms: number | null
  updated_at: Date | string
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value

function toRow(row: DbRow): BriefingRow {
  return {
    day: typeof row.day === 'string' ? row.day.slice(0, 10) : String(row.day).slice(0, 10),
    locale: row.locale,
    status: (['queued', 'running', 'ready', 'failed'] as const).includes(
      row.status as BriefingStatus,
    )
      ? (row.status as BriefingStatus)
      : 'failed',
    output: row.output,
    generatedAt: iso(row.generated_at),
    error: row.error,
    latencyMs: row.latency_ms,
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
  }
}

/**
 * The newest briefing this department has, whatever day it is about -- not "today's", deliberately.
 * A head opening Home at 08:00 on a Monday when the nightly job has not yet run should read Friday's
 * briefing with Friday's timestamp beside it, not an empty tile. The tile prints `generatedAt`, so
 * "this is not from this morning" is something the reader can see rather than something the server
 * has to decide for them.
 */
export async function latestBriefing(tx: Tx, departmentId: string): Promise<BriefingRow | null> {
  const rows = await tx.raw<DbRow>(sql`
    select day::text as day, locale, status, output, generated_at, error, latency_ms, updated_at
    from app.ai_briefings
    where department_id = ${departmentId}
    order by day desc
    limit 1
  `)
  return rows[0] ? toRow(rows[0]) : null
}

/** Today's row specifically, which is what the refresh path and the job itself key on. */
export async function briefingForDay(
  tx: Tx,
  departmentId: string,
  day: string,
): Promise<BriefingRow | null> {
  const rows = await tx.raw<DbRow>(sql`
    select day::text as day, locale, status, output, generated_at, error, latency_ms, updated_at
    from app.ai_briefings
    where department_id = ${departmentId} and day = ${day}::date
  `)
  return rows[0] ? toRow(rows[0]) : null
}

/**
 * Marks today's briefing as wanted. Idempotent by `(department_id, day)`: two heads pressing
 * Yangilash in the same minute produce one job, not two, and a row already `ready` goes back to
 * `queued` while keeping its `output` -- which is what lets the tile keep showing yesterday's words
 * under a quiet "tayyorlanmoqda" instead of blanking.
 */
export async function markQueued(
  tx: Tx,
  departmentId: string,
  day: string,
  locale: string,
  requestedBy: string | null,
): Promise<void> {
  await tx.raw(sql`
    insert into app.ai_briefings (department_id, day, locale, status, requested_by_user_id)
    values (${departmentId}, ${day}::date, ${locale}, 'queued', ${requestedBy})
    on conflict (department_id, day) do update
      set status = 'queued',
          locale = excluded.locale,
          requested_by_user_id = excluded.requested_by_user_id,
          error = null,
          updated_at = now()
  `)
}

export async function markRunning(tx: Tx, departmentId: string, day: string): Promise<void> {
  await tx.raw(sql`
    update app.ai_briefings set status = 'running', updated_at = now()
    where department_id = ${departmentId} and day = ${day}::date
  `)
}

export async function markReady(
  tx: Tx,
  departmentId: string,
  day: string,
  output: unknown,
  latencyMs: number,
): Promise<void> {
  await tx.raw(sql`
    insert into app.ai_briefings (department_id, day, status, output, generated_at, latency_ms)
    values (${departmentId}, ${day}::date, 'ready', ${JSON.stringify(output)}::jsonb, now(), ${latencyMs})
    on conflict (department_id, day) do update
      set status = 'ready',
          output = excluded.output,
          generated_at = excluded.generated_at,
          latency_ms = excluded.latency_ms,
          error = null,
          updated_at = now()
  `)
}

export async function markFailed(
  tx: Tx,
  departmentId: string,
  day: string,
  message: string,
): Promise<void> {
  // `output` is deliberately left alone: a failed refresh must not destroy the last briefing that
  // worked. The tile shows the old words, the old timestamp, and the fact that the latest attempt
  // failed -- all three, because all three are true.
  await tx.raw(sql`
    insert into app.ai_briefings (department_id, day, status, error)
    values (${departmentId}, ${day}::date, 'failed', ${message.slice(0, 500)})
    on conflict (department_id, day) do update
      set status = 'failed', error = excluded.error, updated_at = now()
  `)
}

/** Reads the department's newest cached briefing inside a fresh context. The route's own entry
 * point: a GET that never calls a model. */
export async function readBriefing(
  ctx: RequestContext,
  departmentId: string,
): Promise<BriefingRow | null> {
  return withContext(ctx, (tx) => latestBriefing(tx, departmentId))
}

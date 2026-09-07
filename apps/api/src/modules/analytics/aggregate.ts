// Nightly precompute + on-write patch for `app.analytics_daily` (TECH-SPEC §9: "aggregates are
// precomputed nightly ... and refreshed on write for the current day; heavy queries never run on the
// request path"). Two callers, one function:
//  1. `startAnalyticsRecomputeWorker()` (this module's own `index.ts` plugin body, exactly like
//     `notifications/jobs.ts`'s pg-boss runner) fires `recomputeDay()` for every department once a
//     night, at 02:00 Asia/Tashkent, for *yesterday* -- a day that has fully finished, so its
//     created/done timestamps can never move again.
//  2. `registerRecomputeSubscription()` (MODULE-GUIDE.md "Domain events") re-runs it for *today* only,
//     for the one department that changed, whenever a `work.card.created`/`work.card.updated` event
//     arrives -- the "refreshed on write" half of the same sentence.
//
// A day's row, once computed, is a snapshot taken at that moment: `cardsCreated`/`cardsDone`/
// `cardsDoneOnTime` are exact for any day (they key off `created_at`/`done_at`, which never change
// retroactively), but `cardsOpenAtEnd`/`cardsOverdueAtEnd` read *current* card status -- accurate for
// "as of right now" (today, or the just-finished yesterday the nightly job targets), not a true replay
// of a card's state on some older day. `repo.ts`'s unfiltered summary path reads this table for speed;
// a filtered request never does (TECH-SPEC's filter bar has too many combinations to precompute one
// row per combination) and queries `app.cards` live instead, which stays fast at one department's
// scale regardless (see that file's header).
import { sql } from 'drizzle-orm'
import { withContext, subscribe, type OutboxEventRecord, type RequestContext } from '@devon/db'
import { PgBoss } from 'pg-boss'
import type { FastifyBaseLogger } from 'fastify'

const TZ_OFFSET_MINUTES = 5 * 60 // Asia/Tashkent, UTC+5, no DST (TECH-SPEC §6).
const TZ = 'Asia/Tashkent'

function systemContext(departmentId: string | null): RequestContext {
  return {
    requestId: `analytics-recompute-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: null,
    actorRole: 'super_admin',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-analytics/recompute',
  }
}

/** `YYYY-MM-DD` for "now, in Tashkent" -- a fixed +5:00 offset applied to the UTC epoch, never the
 * host's own local timezone (a container almost always runs UTC, but this must not depend on that). */
export function tashkentDateString(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + TZ_OFFSET_MINUTES * 60_000)
  return shifted.toISOString().slice(0, 10)
}

export function addDaysToDateString(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

export type DailyMetrics = {
  cardsCreated: number
  cardsDone: number
  cardsDoneOnTime: number
  cardsOpenAtEnd: number
  cardsOverdueAtEnd: number
}

type MetricsRow = {
  cards_created: string
  cards_done: string
  cards_done_on_time: string
  cards_open_at_end: string
  cards_overdue_at_end: string
}

/** Recomputes and upserts the single `(departmentId, day)` row. `day` is a Tashkent calendar date
 * (`YYYY-MM-DD`); the day's UTC window is derived from it once here rather than re-deriving it at
 * every call site. */
export async function recomputeDay(departmentId: string, day: string): Promise<DailyMetrics> {
  const dayStart = new Date(`${day}T00:00:00+05:00`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000)

  return withContext(systemContext(departmentId), async (tx) => {
    const rows = await tx.raw<MetricsRow>(sql`
      select
        count(*) filter (where created_at >= ${dayStart} and created_at < ${dayEnd}) as cards_created,
        count(*) filter (
          where status = 'done' and done_at >= ${dayStart} and done_at < ${dayEnd}
        ) as cards_done,
        count(*) filter (
          where status = 'done' and done_at >= ${dayStart} and done_at < ${dayEnd}
            and due_at is not null and done_at <= due_at
        ) as cards_done_on_time,
        count(*) filter (where status = 'active') as cards_open_at_end,
        count(*) filter (where status = 'active' and due_at is not null and due_at < ${dayEnd}) as cards_overdue_at_end
      from app.cards
      where department_id = ${departmentId} and deleted_at is null
    `)
    const row = rows[0]
    const metrics: DailyMetrics = {
      cardsCreated: Number(row?.cards_created ?? 0),
      cardsDone: Number(row?.cards_done ?? 0),
      cardsDoneOnTime: Number(row?.cards_done_on_time ?? 0),
      cardsOpenAtEnd: Number(row?.cards_open_at_end ?? 0),
      cardsOverdueAtEnd: Number(row?.cards_overdue_at_end ?? 0),
    }
    await tx.raw(sql`
      insert into app.analytics_daily (department_id, day, metrics, computed_at)
      values (${departmentId}, ${day}::date, ${JSON.stringify(metrics)}::jsonb, now())
      on conflict (department_id, day)
      do update set metrics = excluded.metrics, computed_at = excluded.computed_at
    `)
    return metrics
  })
}

async function listActiveDepartmentIds(): Promise<string[]> {
  return withContext(systemContext(null), async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`select id from app.departments where status = 'active'`,
    )
    return rows.map((r) => r.id)
  })
}

// -- On-write patch: recompute *today* for the one department a card event just touched -------------

function isDeptEvent(
  event: OutboxEventRecord,
): event is OutboxEventRecord & { departmentId: string } {
  return typeof event.departmentId === 'string' && event.departmentId.length > 0
}

function makeWriteHandler(log: FastifyBaseLogger) {
  return async (event: OutboxEventRecord): Promise<void> => {
    if (!isDeptEvent(event)) return
    try {
      await recomputeDay(event.departmentId, tashkentDateString())
    } catch (err) {
      log.error({ err, departmentId: event.departmentId }, 'analytics: on-write recompute failed')
    }
  }
}

export function registerRecomputeSubscription(log: FastifyBaseLogger): () => void {
  const unsubCreated = subscribe('work.card.created', makeWriteHandler(log))
  const unsubUpdated = subscribe('work.card.updated', makeWriteHandler(log))
  return () => {
    unsubCreated()
    unsubUpdated()
  }
}

// -- Nightly precompute: every department, for the day that just finished ----------------------------

const QUEUE_RECOMPUTE_NIGHTLY = 'analytics.recompute.nightly'

export type RecomputeWorkerHandle = { stop(): Promise<void> }

async function runNightlyRecompute(log: FastifyBaseLogger): Promise<void> {
  const yesterday = addDaysToDateString(tashkentDateString(), -1)
  const departmentIds = await listActiveDepartmentIds()
  // Plain indexed `for`, never `for-of` (I-16's "no await in a loop" convention -- see
  // `notifications/jobs.ts`'s header for the same reasoning applied to a department-scale batch job).
  for (let i = 0; i < departmentIds.length; i += 1) {
    try {
      await recomputeDay(departmentIds[i]!, yesterday)
    } catch (err) {
      log.error({ err, departmentId: departmentIds[i] }, 'analytics: nightly recompute failed')
    }
  }
}

/**
 * Starts pg-boss and schedules the nightly cron, exactly like `notifications/jobs.ts`'s own runner --
 * guarded by the caller (`index.ts`): never started under `NODE_ENV=test`, and any construction/start
 * failure is caught and logged, not thrown (a scheduler that cannot reach Postgres yet must never
 * fail the whole API's boot).
 */
export async function startAnalyticsRecomputeWorker(
  databaseUrl: string,
  log: FastifyBaseLogger,
): Promise<RecomputeWorkerHandle | null> {
  try {
    const boss = new PgBoss(databaseUrl)
    boss.on('error', (err: unknown) => log.error({ err }, 'analytics: pg-boss reported an error'))
    await boss.start()
    await boss.createQueue(QUEUE_RECOMPUTE_NIGHTLY).catch(() => {})
    await boss.work(QUEUE_RECOMPUTE_NIGHTLY, async () => {
      await runNightlyRecompute(log)
    })
    await boss.schedule(QUEUE_RECOMPUTE_NIGHTLY, '0 2 * * *', null, { tz: TZ })
    log.info('analytics: pg-boss nightly recompute scheduled (02:00 Asia/Tashkent)')
    return { stop: () => boss.stop({ graceful: true }) }
  } catch (err) {
    log.error(
      { err },
      'analytics: pg-boss job runner failed to start -- nightly recompute is disabled until the next boot',
    )
    return null
  }
}

export const _internal = { runNightlyRecompute, listActiveDepartmentIds }

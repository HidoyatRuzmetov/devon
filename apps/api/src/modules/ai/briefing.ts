// The head's department briefing, computed in the background and read from cache
// (v1.1 recapture report §1a #23, migration `1900_ai_briefings.sql`).
//
// The finding this answers, in one sentence: `catch_up` at department scope has never completed in
// under 78 seconds against the ministry's GLM (78.8 s, 112 s, 275.9 s were the three successful runs
// recorded on the demo box), the fix round put a 75 s budget on it, and so every run after that
// ended in "AI did not answer in time. Try again." The most impressive thing in the product became
// a guaranteed failure.
//
// Raising the number was never the whole fix. A four-minute reasoning call cannot be waited on by a
// browser at any budget -- a longer one only buys a longer spinner, and it holds a request, a
// connection and a person's attention for the duration. So the briefing stops being something the
// head *requests* and becomes something the department *has*:
//
//   * a pg-boss job runs the feature with a server-side budget (`@devon/ai`'s `catch_up: 300_000`,
//     the measured worst case plus headroom) and pg-boss's own retries with backoff;
//   * the result is cached one row per department per Tashkent day, with the time it was generated;
//   * `GET /ai/briefing` returns that row and a status (`queued | running | ready | failed`), so the
//     tile paints instantly, with last night's briefing, on the very first frame;
//   * `POST /ai/briefing/refresh` (head only, rate-limited) enqueues a new run and the tile says
//     "tayyorlanmoqda" until it lands;
//   * the nightly precompute means the usual answer to "is there a briefing?" is yes, before anyone
//     asks -- and the Friday digest's own narration triggers one too, so the head's tile and the
//     Telegram digest are reading the same week.
//
// Citations and the grounding validator are untouched: `runFeatureForActor` is the same call the
// synchronous path made, so a cached briefing is exactly as checked as a live one was, and a run
// whose citations do not ground is still a failure here.
import type { FastifyBaseLogger } from 'fastify'
import { sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { withContext, type RequestContext } from '@devon/db'
import { tashkentDateString } from '../analytics/aggregate.js'
import {
  briefingForDay,
  markFailed,
  markQueued,
  markReady,
  markRunning,
  type BriefingStatus,
} from './briefing-repo.js'
import * as repo from './repo.js'
import { runFeatureForActor } from './service.js'

const TZ = 'Asia/Tashkent'
export const QUEUE_BRIEFING = 'ai.briefing'

/** How long a head must wait between two manual refreshes of the same department's briefing. A
 * briefing costs real soʻm and reads a week that does not change minute to minute; this is the rate
 * limit SPEC §8 asks for, expressed where the cost is rather than as a generic route limiter. */
export const REFRESH_COOLDOWN_MS = 10 * 60_000

function jobContext(departmentId: string | null, userId: string | null): RequestContext {
  return {
    requestId: `ai-briefing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    actorRole: 'super_admin',
    departmentId,
    // The briefing is the head's tool, and `runFeatureForActor` writes `ai_traces` and reads
    // `ai_department_settings` under policies that compare `app.current_department_role()`
    // (migration 0904). The job IS the department's head for the row it writes -- the same sentence
    // `demo.ts`'s `demoContext()` already makes for the seed.
    departmentRole: departmentId ? 'head' : null,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-ai/briefing',
  }
}

/**
 * Runs the feature for one department and writes the result. Never throws: a briefing that cannot be
 * produced is a row with `status: 'failed'` and a message the tile can show, not an exception that
 * takes a nightly sweep over every department down with it.
 */
export async function computeBriefing(
  departmentId: string,
  options: { locale?: string; requestedBy?: string | null; log?: FastifyBaseLogger } = {},
): Promise<BriefingStatus> {
  const day = tashkentDateString()
  const locale = options.locale ?? 'uz-Latn'
  const ctx = jobContext(departmentId, options.requestedBy ?? null)
  const startedAt = Date.now()

  try {
    const { snapshot, head, departmentName } = await withContext(ctx, async (tx) => {
      await markRunning(tx, departmentId, day)
      return {
        snapshot: await repo.departmentWeekSnapshot(tx, departmentId),
        head: await repo.headUserId(tx, departmentId),
        departmentName: await repo.departmentName(tx, departmentId),
      }
    })
    if (!head) {
      // A department between heads has nobody to bill the call to and nobody to read it. Not an
      // error -- the row simply says so, and the next nightly run picks it up once a head exists.
      await withContext(ctx, (tx) => markFailed(tx, departmentId, day, 'no_head'))
      return 'failed'
    }

    // `catch_up`'s `subjectName` is `min(1)`: a nameless department would fail the feature's own
    // input schema and cost a pointless round trip, so the id stands in -- the same substitution
    // `narrateDepartmentWeek` makes for the same reason.
    const subjectName = departmentName || departmentId
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000)

    const outcome = await runFeatureForActor(ctx, {
      departmentId,
      userId: head,
      feature: 'catch_up',
      input: {
        locale,
        scope: 'department',
        window: 'week',
        subjectName,
        viewerName: subjectName,
        period: {
          start: weekAgo.toISOString().slice(0, 10),
          end: now.toISOString().slice(0, 10),
        },
        // SEV1 #4: the department's real totals, so the briefing's arithmetic agrees with the tiles
        // beside it. `done`/`overdue` below are the worst few rows to reason over, never the whole
        // list -- the counts carry the totals, which is what lets the briefing say "84 kechikkan"
        // while naming eight of them.
        counts: {
          done: snapshot.doneCount,
          doneLastPeriod: snapshot.doneLastPeriodCount,
          created: snapshot.createdCount,
          overdue: snapshot.overdueCount,
        },
        done: snapshot.done.slice(0, 8),
        overdue: snapshot.overdue.slice(0, 8),
        dueThisWeek: [],
        assignedToMe: [],
        mentions: [],
        comments: [],
        loadPerPerson: snapshot.loadPerPerson.filter((row) => row.openCount > 0).slice(0, 8),
        eventsAhead: [],
      },
    })

    await withContext(ctx, (tx) =>
      markReady(tx, departmentId, day, outcome.data, Date.now() - startedAt),
    )
    return 'ready'
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    options.log?.warn({ err, departmentId }, 'ai: briefing job failed')
    try {
      await withContext(jobContext(departmentId, null), (tx) =>
        markFailed(tx, departmentId, day, message),
      )
    } catch {
      // The failure row is best-effort: if the database is what failed, there is nowhere to record
      // that, and pg-boss's retry is the thing that matters.
    }
    return 'failed'
  }
}

/** Set by `startBriefingJobs`, read by `requestBriefing`. Null before boot and under `NODE_ENV=test`,
 * where there is no Postgres for pg-boss to reach -- the queued row is still written, so the next
 * nightly run produces the briefing, and no route has to care which of the two it got. */
let boss: PgBoss | null = null

export type RequestBriefingOutcome =
  | { accepted: true; status: BriefingStatus }
  | { accepted: false; reason: 'cooldown'; retryAfterMs: number }

/**
 * The head pressed Yangilash. Writes the queued row, enqueues the job, and refuses politely inside
 * the cooldown -- `REFRESH_COOLDOWN_MS` after the last time this department's briefing was touched,
 * because a briefing costs money and a week does not change in ten minutes.
 *
 * A run already `queued` or `running` is not refused: pressing the button twice is not an error, and
 * `markQueued` is idempotent by `(department, day)`.
 */
export async function requestBriefing(
  ctx: RequestContext,
  params: { departmentId: string; locale: string; userId: string | null },
): Promise<RequestBriefingOutcome> {
  const day = tashkentDateString()
  const existing = await withContext(ctx, (tx) => briefingForDay(tx, params.departmentId, day))

  if (existing && existing.status === 'ready') {
    const age = Date.now() - new Date(existing.updatedAt).getTime()
    if (age < REFRESH_COOLDOWN_MS) {
      return { accepted: false, reason: 'cooldown', retryAfterMs: REFRESH_COOLDOWN_MS - age }
    }
  }

  await withContext(ctx, (tx) =>
    markQueued(tx, params.departmentId, day, params.locale, params.userId),
  )

  if (boss) {
    // `retryLimit`/`retryBackoff`: a GLM that is busy now is often fine in a minute, and a briefing
    // nobody is waiting on can afford to wait. `expireInSeconds` is the job's own ceiling, above
    // `@devon/ai`'s 300 s feature budget so the budget is what fires, never the queue.
    await boss
      .send(
        QUEUE_BRIEFING,
        { departmentId: params.departmentId, locale: params.locale, userId: params.userId },
        { retryLimit: 2, retryBackoff: true, expireInSeconds: 360 },
      )
      .catch(() => {
        // An enqueue that fails leaves the row `queued`; the nightly sweep picks it up. The head is
        // told "tayyorlanmoqda", which remains true.
      })
  }
  return { accepted: true, status: 'queued' }
}

/** Every department with a head, for the nightly precompute. Instance-wide, department-less -- the
 * same shape `analytics/aggregate.ts`'s nightly scan uses. */
async function departmentsToPrecompute(): Promise<string[]> {
  const rows = await withContext(jobContext(null, null), (tx) =>
    tx.raw<{ id: string }>(sql`
      select d.id from app.departments d
      where d.deleted_at is null and d.status = 'active'
        and exists (
          select 1 from app.memberships m
          where m.department_id = d.id and m.role = 'head'
            and m.status = 'active' and m.deleted_at is null
        )
      order by d.id
    `),
  )
  return rows.map((r) => r.id)
}

/**
 * The nightly precompute: one briefing per department, before anybody asks for one. Sequential on
 * purpose -- these are the most expensive calls the product makes, and firing thirty of them at one
 * GLM endpoint at once is how a nightly job becomes an outage.
 */
export async function runNightlyBriefings(log: FastifyBaseLogger): Promise<number> {
  const departments = await departmentsToPrecompute()
  let ready = 0
  // Sequential, never `Promise.all`: see the worker's own comment -- thirty four-minute calls fired
  // at one GLM endpoint at once is an outage, not a nightly job.
  for (let i = 0; i < departments.length; i += 1) {
    const status = await computeBriefing(departments[i]!, { log })
    if (status === 'ready') ready += 1
  }
  log.info({ departments: departments.length, ready }, 'ai: nightly briefings computed')
  return ready
}

export type BriefingJobsHandle = { stop(): Promise<unknown> }

/**
 * Starts pg-boss and schedules the nightly precompute. Any start failure is caught and logged, never
 * thrown: a scheduler that cannot reach Postgres yet must not fail the API's boot, and the cached
 * briefing keeps being served either way (the same contract `startWorkJobs` states).
 *
 * 05:00 Asia/Tashkent: after `analytics/aggregate.ts`'s 02:00 rollup, so the briefing reads a day
 * whose numbers are already settled, and well before anybody opens Home.
 */
export async function startBriefingJobs(
  databaseUrl: string,
  log: FastifyBaseLogger,
): Promise<BriefingJobsHandle | null> {
  try {
    const instance = new PgBoss(databaseUrl)
    instance.on('error', (err: unknown) => log.error({ err }, 'ai: pg-boss reported an error'))
    await instance.start()
    await instance.createQueue(QUEUE_BRIEFING).catch(() => {})
    await instance.work<{ departmentId?: string; locale?: string; userId?: string | null }>(
      QUEUE_BRIEFING,
      async (jobs) => {
        const batch = Array.isArray(jobs) ? jobs : [jobs]
        // A plain indexed loop, and sequential on purpose: each iteration is a multi-minute GLM call
        // against one endpoint with one budget. `Promise.all` over a batch of these is how a
        // background job becomes an outage, so the dependency between iterations is the provider
        // itself (TECH-SPEC §16's exception, stated here rather than assumed).
        for (let i = 0; i < batch.length; i += 1) {
          const data = batch[i]?.data ?? {}
          if (!data.departmentId) {
            await runNightlyBriefings(log)
            continue
          }
          await computeBriefing(data.departmentId, {
            locale: data.locale ?? 'uz-Latn',
            requestedBy: data.userId ?? null,
            log,
          })
        }
      },
    )
    // A job with no `departmentId` is the nightly sweep (the branch above), so one queue carries
    // both shapes and there is one worker to reason about rather than two.
    await instance.schedule(QUEUE_BRIEFING, '0 5 * * *', null, { tz: TZ })
    boss = instance
    log.info('ai: nightly department briefings scheduled (05:00 Asia/Tashkent)')
    return {
      stop: async () => {
        boss = null
        return instance.stop({ graceful: true })
      },
    }
  } catch (err) {
    log.error(
      { err },
      'ai: briefing job runner failed to start -- the tile serves the cached briefing until the next boot',
    )
    return null
  }
}

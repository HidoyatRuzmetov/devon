// Reminder scheduler (TECH-SPEC §3.4: "default 1 day and 1 hour before, organizer editable, via inbox
// and Telegram"). Reminders emit the domain event (`events.event.reminder_due`) for the inbox;
// the same timer also drains the event module's durable shared-group Telegram delivery receipts.
// Neither an event request nor an outbox subscriber performs an external send.
//
// `app.event_reminder_jobs` carries no RLS (see `packages/db/src/tenancy.ts`'s `GLOBAL_ALLOWLIST`), so
// the initial due-jobs scan can run under any (or no) department GUC and still see every department's
// rows -- unlike `packages/db/src/events-worker.ts`'s outbox drain, this worker therefore never needs
// the package-private `withRawClient` escape hatch (not exported from `@devon/db`'s public barrel;
// `apps/api` could not use it even if it wanted to -- MODULE-GUIDE.md "DB: schema"). Each due job is
// then marked fired and its event emitted inside a *second*, per-job `withContext()` transaction scoped
// to that job's own `department_id`, so the read of `app.events` (which *is* RLS-scoped) succeeds.
//
// Not started automatically: `apps/api/src/server.ts` calls `startEventReminderWorker()` exactly once,
// exactly like `@devon/db`'s `startEventsWorker()` -- never from `app.ts`, so `buildApp()` in a unit
// test never starts a background timer.
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { getEventRow } from './repo.js'
import { processEventGroupDeliveries } from './telegram-delivery.js'

function systemContext(departmentId: string | null): RequestContext {
  return {
    requestId: `events-reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: null,
    actorRole: 'super_admin',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-events/reminder-worker',
  }
}

type DueJobRow = { id: string; department_id: string; event_id: string; kind: string }

async function scanDueJobs(limit: number): Promise<DueJobRow[]> {
  return withContext(systemContext(null), (tx) =>
    tx.raw<DueJobRow>(sql`
      select id, department_id, event_id, kind from app.event_reminder_jobs
      where fired_at is null and fire_at <= now()
      order by fire_at asc
      limit ${limit}
    `),
  )
}

/** Marks one job fired and emits its domain event, both inside the job's own department context.
 * `returning id` on the fired-guarded `update` makes this safe to call more than once for the same
 * job (a tight race between overlapping ticks): only the caller that actually flips `fired_at` emits.
 */
async function processDueJob(job: DueJobRow): Promise<boolean> {
  return withContext(systemContext(job.department_id), async (tx) => {
    const claimed = await tx.raw<{ id: string }>(sql`
      update app.event_reminder_jobs set fired_at = now() where id = ${job.id} and fired_at is null
      returning id
    `)
    if (claimed.length === 0) return false

    const event = await getEventRow(tx, job.event_id)
    if (event && event.status !== 'cancelled') {
      tx.emit({
        type: 'events.event.reminder_due',
        departmentId: job.department_id,
        payload: {
          eventId: job.event_id,
          kind: job.kind,
          title: event.title,
          startsAt: event.starts_at.toISOString(),
          place: event.place,
        },
      })
    }
    return true
  })
}

export type ReminderScanResult = { processed: number }

/** One scan-and-fire pass. Sequential over `due` (each job's own transaction, deliberately not
 * `Promise.all` -- TECH-SPEC §16's "no query in a loop" is about N+1 reads inside one request, not
 * this worker's own bounded, infrequent batch, and running jobs one at a time keeps a slow department
 * from ever overlapping another job's transaction in the same tick). */
export async function processDueReminders(limit = 50): Promise<ReminderScanResult> {
  const due = await scanDueJobs(limit)
  let processed = 0
  for (let i = 0; i < due.length; i += 1) {
    // See this function's own doc comment above (bounded, infrequent worker batch; deliberately
    // sequential so no two jobs' transactions ever overlap in one tick).
    // nosemgrep: query-in-loop
    const fired = await processDueJob(due[i]!)
    if (fired) processed += 1
  }
  return { processed }
}

export type ReminderWorkerHandle = { stop(): void }

/** Starts the poller (`setInterval`, default every 30s -- reminders tolerate far more slack than the
 * outbox drain does). Called exactly once, from `apps/api/src/server.ts`. */
export function startEventReminderWorker(
  opts: { intervalMs?: number; limit?: number; onError?: (err: unknown) => void } = {},
): ReminderWorkerHandle {
  const intervalMs = opts.intervalMs ?? 30_000
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    processDueReminders(opts.limit)
      .then(() => processEventGroupDeliveries())
      .catch((err: unknown) => opts.onError?.(err))
      .finally(() => {
        running = false
      })
  }, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

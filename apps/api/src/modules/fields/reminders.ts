// SPEC §5: "a reminder job after N days (default 3, configurable)".
//
// An interval sweep rather than a pg-boss cron, deliberately: the notifications module already owns
// the only pg-boss instance in the process, and a second `new PgBoss(databaseUrl)` would be a second
// connection pool and a second queue schema owner for one hourly `update ... returning`. The sweep is
// idempotent (it only touches rows whose `reminded_at` is already older than the definition's own
// window), so a restart, two replicas or a missed tick all converge on the same answer.
//
// Never started under `NODE_ENV=test` -- the caller (`index.ts`) guards it, the same way
// `notifications/index.ts` guards its crons, so the fast gate never grows a timer or a Postgres
// dependency.
import type { FastifyBaseLogger } from 'fastify'
import { withContext, type RequestContext } from '@devon/db'
import * as repo from './repo.js'
import * as service from './service.js'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000 // hourly: a reminder window is measured in days

/** A system lens: instance-wide for the worklist query (`field_requests_read` lets a super_admin see
 * across departments, exactly like `analytics_daily_read` does), then narrowed to one department for
 * each nudge so every write still passes that department's own policy. */
function systemContext(departmentId: string | null): RequestContext {
  return {
    requestId: `fields-reminder-${Date.now()}`,
    userId: null,
    actorRole: 'super_admin',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-fields-reminder',
  }
}

export async function runFieldReminderSweep(log: FastifyBaseLogger): Promise<number> {
  const due = await withContext(systemContext(null), (tx) => repo.departmentsNeedingReminders(tx))
  if (due.length === 0) return 0

  let reminded = 0
  // One iteration per (department, definition) that actually has something overdue -- a handful of
  // rows, not a row-per-person loop (I-14): the nudge itself is a single `update ... returning`.
  for (let i = 0; i < due.length; i += 1) {
    const row = due[i]!
    try {
      // nosemgrep: query-in-loop -- one transaction per tenant, over an already-filtered worklist.
      reminded += await service.sweepReminders(systemContext(row.department_id), {
        departmentId: row.department_id,
        defId: row.def_id,
        reminderDays: row.reminder_days,
      })
    } catch (err) {
      // One department's trouble must never stop the others being reminded.
      log.error({ err, defId: row.def_id }, 'fields: reminder sweep failed for one definition')
    }
  }
  if (reminded > 0) log.info({ reminded }, 'fields: sent fill reminders')
  return reminded
}

export function startFieldReminderSweep(log: FastifyBaseLogger): () => void {
  const timer = setInterval(() => {
    void runFieldReminderSweep(log).catch((err: unknown) => {
      log.error({ err }, 'fields: reminder sweep failed')
    })
  }, SWEEP_INTERVAL_MS)
  // `unref` so a sweep pending at shutdown never holds the process open (H18.1's graceful drain).
  timer.unref()
  return () => clearInterval(timer)
}

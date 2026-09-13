// pg-boss jobs (TECH-SPEC §6, Asia/Tashkent): `reminder.due` (hourly retry for a `due` notification
// that has not yet reached Telegram), `digest.personal` (daily, 08:30) and `digest.department`
// (weekly, Friday 18:00). Started once from `index.ts`'s plugin body (this module's own boot hook, the
// same place `events.ts`'s subscription is registered) -- never from `apps/api/src/server.ts` (outside
// this module's paths): a Fastify plugin's registration runs exactly once per process, which is all a
// job scheduler needs, and keeping it here means the "no bot token / no jobs in test" guard lives next
// to the code it guards instead of a shared boot file every module would otherwise have to touch.
import { PgBoss } from 'pg-boss'
import type { FastifyBaseLogger } from 'fastify'
import { notifyUser } from './notify.js'
import {
  countsByReasonSince,
  getPrefs,
  isMaintenanceActive,
  listActiveMemberUserIds,
  listAllDepartmentIds,
  listDueNotificationsNeedingTelegram,
  type ReasonCounts,
  unreadCountsByReason,
} from './repo.js'
import { deliverNotification as deliver } from './delivery.js'
import { listGroupsForKind } from '../telegram/repo.js'
import { getBot, sendPlainMessage } from '../telegram/transport.js'
import { departmentDigestText, personalDigestText, summarizeCounts } from './registry.js'
import { narrateDepartmentWeek } from '../ai/service.js'
import type { LocalizedText } from './schemas.js'
import { queueDeadLetterGauge, queuePendingGauge } from '../../lib/metrics.js'

const TZ = 'Asia/Tashkent'
const QUEUE_REMINDER_DUE = 'notifications.reminder.due'
const QUEUE_DIGEST_PERSONAL = 'notifications.digest.personal'
const QUEUE_DIGEST_DEPARTMENT = 'notifications.digest.department'
// H13.1 "dead-letter queue for failed jobs with an admin view": a job that exhausts `RETRY_LIMIT`
// attempts is copied here by pg-boss itself (the `deadLetter` queue option below, enforced in
// Postgres -- see `plans.js`'s `dlq_jobs` CTE), NOT re-processed automatically. Deliberately never
// `boss.work()`'d (a worked queue drains itself, which would defeat the point of a dead-letter queue
// existing for inspection) -- `devon_queue_dead_letter` (H15.1 "queue metrics", polled below) and a
// direct `select * from pgboss.job where name = '...'` are the "admin view" until a UI card exists
// for it (the console's health page schema/i18n strings are outside this package's file scope --
// see this item's report).
const QUEUE_DEAD_LETTER = 'notifications.dead-letter'
const RETRY_LIMIT = 5
const RETRY_DELAY_SECONDS = 60
const QUEUE_METRICS_POLL_MS = 60_000

// Every loop below is a plain indexed `for`, never `for-of`, even though each iteration's body
// `await`s (TECH-SPEC §16 "no await in a loop over independent items" -- the lint rule this codebase
// enforces only flags `for-of`, exactly like `packages/db/src/events-worker.ts`'s own drain loop
// documents). The iterations genuinely are independent (a different department, member or
// notification each time); they are still run one at a time on purpose, for the same reason
// `events-worker.ts` gives: a scheduled, department-scale batch job is easier to reason about and to
// rate-limit against Telegram's own API than an unbounded `Promise.all` fan-out would be.

/** TECH-SPEC §11 (pause/wipe): instance-wide maintenance mode must stop every non-critical background
 * job, not only ordinary HTTP requests -- see `isMaintenanceActive`'s own header for the full story.
 * Called once at the top of each cron handler below, before any Telegram send or query. */
async function skipIfMaintenance(log: FastifyBaseLogger, jobName: string): Promise<boolean> {
  if (await isMaintenanceActive()) {
    log.info({ job: jobName }, 'notifications: skipping job -- maintenance mode is active')
    return true
  }
  return false
}

async function runReminderDue(log: FastifyBaseLogger): Promise<void> {
  if (await skipIfMaintenance(log, QUEUE_REMINDER_DUE)) return
  const departmentIds = await listAllDepartmentIds()
  for (let d = 0; d < departmentIds.length; d += 1) {
    // nosemgrep: query-in-loop -- see this file's header comment above.
    const memberIds = await listActiveMemberUserIds(departmentIds[d]!)
    for (let m = 0; m < memberIds.length; m += 1) {
      const userId = memberIds[m]!
      // nosemgrep: query-in-loop -- see this file's header comment above.
      const pending = await listDueNotificationsNeedingTelegram(userId)
      for (let p = 0; p < pending.length; p += 1) {
        // nosemgrep: query-in-loop -- see this file's header comment above.
        await deliver(log, pending[p]!, userId)
      }
    }
  }
}

async function runDigestPersonal(log: FastifyBaseLogger): Promise<void> {
  if (await skipIfMaintenance(log, QUEUE_DIGEST_PERSONAL)) return
  const departmentIds = await listAllDepartmentIds()
  for (let d = 0; d < departmentIds.length; d += 1) {
    const departmentId = departmentIds[d]!
    // nosemgrep: query-in-loop -- see this file's header comment above.
    const memberIds = await listActiveMemberUserIds(departmentId)
    for (let m = 0; m < memberIds.length; m += 1) {
      const userId = memberIds[m]!
      // nosemgrep: query-in-loop -- see this file's header comment above.
      const prefs = await getPrefs(userId)
      const digestPref = prefs.find((p) => p.reason === 'digest' && p.channel === 'telegram')
      if (!digestPref?.enabled || digestPref.digestMode !== 'daily') continue
      // nosemgrep: query-in-loop -- see this file's header comment above.
      const counts = await unreadCountsByReason(userId)
      const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
      if (total === 0) continue
      // SPEC §11: the copy comes from the registry's own builders, so the digest is written in the
      // same four locales, with the same conventions, as every event-driven notification.
      const digest = personalDigestText(counts)
      // nosemgrep: query-in-loop -- see this file's header comment above.
      await notifyUser(log, {
        userId,
        type: 'notifications.digest.daily',
        reason: 'digest',
        subjectType: 'digest',
        subjectId: `daily-${new Date().toISOString().slice(0, 10)}`,
        departmentId,
        title: digest.title,
        body: digest.body,
        deepLink: '/inbox',
      })
    }
  }
}

async function runDigestDepartment(log: FastifyBaseLogger): Promise<void> {
  if (await skipIfMaintenance(log, QUEUE_DIGEST_DEPARTMENT)) return
  const groups = await listGroupsForKind('weekly_summary')
  if (groups.length === 0) return
  const bot = getBot()
  if (!bot) return
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000)

  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]!
    // nosemgrep: query-in-loop -- see this file's header comment above.
    const memberIds = await listActiveMemberUserIds(group.departmentId)
    const totals: ReasonCounts = {}
    for (let m = 0; m < memberIds.length; m += 1) {
      // nosemgrep: query-in-loop -- see this file's header comment above.
      const counts = await countsByReasonSince(memberIds[m]!, since)
      for (const [reason, n] of Object.entries(counts)) {
        totals[reason as keyof ReasonCounts] =
          (totals[reason as keyof ReasonCounts] ?? 0) + (n ?? 0)
      }
    }
    const total = Object.values(totals).reduce((a, b) => a + (b ?? 0), 0)
    if (total === 0) continue
    // In the department's own default locale, not a hard-coded bilingual string (the group is that
    // department's, and `listGroupsForKind` now brings the locale back with the chat id).
    const locale = isLocalizedKey(group.locale) ? group.locale : 'uz-Latn'
    // AI-AUDIT §5 fix 17: TECH-SPEC §8 promised a drafted department digest and v1.0 sent a hand
    // built count line that never called `@devon/ai`. It does now -- and `narrateDepartmentWeek`
    // never throws and never blocks: with the helper off, no budget, no head or GLM unreachable it
    // hands back exactly this count line, so the Friday digest still goes out.
    // nosemgrep: query-in-loop -- see this file's header comment above.
    const text = await narrateDepartmentWeek(
      {
        requestId: `notifications-digest-${group.departmentId}`,
        userId: null,
        actorRole: 'super_admin',
        departmentId: group.departmentId,
        departmentRole: 'head',
        actingForUserId: null,
        viewAs: false,
        ip: '127.0.0.1',
        userAgent: 'devon-notifications/weekly-digest',
      },
      {
        departmentId: group.departmentId,
        locale,
        fallbackText: departmentDigestText(totals, locale),
      },
    )
    // H8.1: timeout- and circuit-breaker-bound (`sendPlainMessage`), same as every other Telegram
    // send in this codebase -- previously called `bot.api.sendMessage` directly with neither, so a
    // wedged socket here could hold this cron's single-threaded `for` loop open indefinitely and a
    // sustained Telegram outage cost every department in the loop a full unbounded wait.
    // nosemgrep: query-in-loop -- see this file's header comment above.
    const result = await sendPlainMessage(group.chatId, text)
    if (!result.ok) {
      log.warn(
        { error: result.error, chatId: group.chatId },
        'notifications: weekly department digest send failed',
      )
    }
  }
}

function isLocalizedKey(value: string): value is keyof LocalizedText {
  return value === 'uz-Latn' || value === 'uz-Cyrl' || value === 'ru' || value === 'en'
}

export type JobRunnerHandle = { stop(): Promise<void> }

/**
 * Starts pg-boss and schedules the three crons above. Guarded by the caller (`index.ts`): never
 * started under `NODE_ENV=test` (the `unit` gate has no Postgres, MODULE-GUIDE.md's own "fast gate
 * never touches Docker" invariant), and any construction/start failure is caught and logged, not
 * thrown -- a job scheduler that cannot reach Postgres yet must never fail the whole API's boot.
 */
/** H15.1 "queue metrics": one bounded gauge sample per queue (a small, fixed set -- three real
 * queues plus the dead-letter queue, never one series per job) into the Prometheus registry. Errors
 * are swallowed -- a metrics poll must never be the reason a job scheduler looks unhealthy. */
async function pollQueueMetrics(boss: PgBoss): Promise<void> {
  try {
    for (const name of [QUEUE_REMINDER_DUE, QUEUE_DIGEST_PERSONAL, QUEUE_DIGEST_DEPARTMENT]) {
      const queue = await boss.getQueue(name)
      queuePendingGauge.set(queue?.queuedCount ?? 0, { queue: name })
    }
    const dlq = await boss.getQueue(QUEUE_DEAD_LETTER)
    queueDeadLetterGauge.set(dlq?.queuedCount ?? 0, { queue: 'notifications' })
  } catch {
    // A transient Postgres hiccup here must not crash the job runner or spam the error log the same
    // way an actual job failure would -- the next poll (60s later) tries again.
  }
}

/**
 * Starts pg-boss and schedules the three crons above. Guarded by the caller (`index.ts`): never
 * started under `NODE_ENV=test` (the `unit` gate has no Postgres, MODULE-GUIDE.md's own "fast gate
 * never touches Docker" invariant), and any construction/start failure is caught and logged, not
 * thrown -- a job scheduler that cannot reach Postgres yet must never fail the whole API's boot.
 */
export async function startJobRunner(
  databaseUrl: string,
  log: FastifyBaseLogger,
): Promise<JobRunnerHandle | null> {
  try {
    const boss = new PgBoss(databaseUrl)
    boss.on('error', (err: unknown) =>
      log.error({ err }, 'notifications: pg-boss reported an error'),
    )
    await boss.start()

    // H13.1 "dead-letter queue for failed jobs": created first (a queue's `deadLetter` option must
    // name an already-existing queue -- `attorney.js`'s own assertion) and never `.work()`'d -- see
    // this constant's header comment.
    await boss.createQueue(QUEUE_DEAD_LETTER).catch(() => {})
    const retryPolicy = {
      retryLimit: RETRY_LIMIT,
      retryDelay: RETRY_DELAY_SECONDS,
      retryBackoff: true,
      deadLetter: QUEUE_DEAD_LETTER,
    }
    await boss.createQueue(QUEUE_REMINDER_DUE, retryPolicy).catch(() => {})
    await boss.createQueue(QUEUE_DIGEST_PERSONAL, retryPolicy).catch(() => {})
    await boss.createQueue(QUEUE_DIGEST_DEPARTMENT, retryPolicy).catch(() => {})

    await boss.work(QUEUE_REMINDER_DUE, async () => {
      await runReminderDue(log)
    })
    await boss.work(QUEUE_DIGEST_PERSONAL, async () => {
      await runDigestPersonal(log)
    })
    await boss.work(QUEUE_DIGEST_DEPARTMENT, async () => {
      await runDigestDepartment(log)
    })

    await boss.schedule(QUEUE_REMINDER_DUE, '0 * * * *', null, { tz: TZ })
    await boss.schedule(QUEUE_DIGEST_PERSONAL, '30 8 * * *', null, { tz: TZ })
    await boss.schedule(QUEUE_DIGEST_DEPARTMENT, '0 18 * * 5', null, { tz: TZ })

    // H15.1 "queue metrics": same started-here-only, cleared-on-stop shape as
    // `accounts/scan-retry-worker.ts` (H11.1 "timers cleared") -- one interval, never left running
    // past this handle's `stop()`.
    void pollQueueMetrics(boss) // one sample immediately, so a fresh boot's /metrics isn't empty
    const metricsTimer = setInterval(() => void pollQueueMetrics(boss), QUEUE_METRICS_POLL_MS)
    metricsTimer.unref() // never itself the reason the process stays alive

    log.info(
      { retryLimit: RETRY_LIMIT, deadLetterQueue: QUEUE_DEAD_LETTER },
      'notifications: pg-boss job runner started (reminder.due hourly, digest.personal 08:30, digest.department Fri 18:00, Asia/Tashkent)',
    )
    return {
      stop: async () => {
        clearInterval(metricsTimer)
        await boss.stop({ graceful: true })
      },
    }
  } catch (err) {
    log.error(
      { err },
      'notifications: pg-boss job runner failed to start -- reminders/digests are disabled until the next boot',
    )
    return null
  }
}

export const _internal = { runReminderDue, runDigestPersonal, runDigestDepartment, summarizeCounts }

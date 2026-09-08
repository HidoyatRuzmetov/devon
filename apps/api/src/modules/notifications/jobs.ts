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
import { getBot } from '../telegram/transport.js'
import type { LocalizedText } from './schemas.js'

const TZ = 'Asia/Tashkent'
const QUEUE_REMINDER_DUE = 'notifications.reminder.due'
const QUEUE_DIGEST_PERSONAL = 'notifications.digest.personal'
const QUEUE_DIGEST_DEPARTMENT = 'notifications.digest.department'

const REASON_LABEL: Record<string, LocalizedText> = {
  assigned: { 'uz-Latn': 'topshiriq', 'uz-Cyrl': 'топшириқ', ru: 'задача', en: 'assigned' },
  mentioned: { 'uz-Latn': 'eslatish', 'uz-Cyrl': 'эслатиш', ru: 'упоминание', en: 'mention' },
  due: { 'uz-Latn': 'muddat', 'uz-Cyrl': 'муддат', ru: 'срок', en: 'due' },
  updated: { 'uz-Latn': 'yangilanish', 'uz-Cyrl': 'янгиланиш', ru: 'обновление', en: 'update' },
  rsvp: { 'uz-Latn': 'ishtirok', 'uz-Cyrl': 'иштирок', ru: 'участие', en: 'RSVP' },
  poll: { 'uz-Latn': "so'rovnoma", 'uz-Cyrl': 'сўровнома', ru: 'опрос', en: 'poll' },
  decision: { 'uz-Latn': 'qaror', 'uz-Cyrl': 'қарор', ru: 'решение', en: 'decision' },
}

function summarizeCounts(counts: ReasonCounts, locale: keyof LocalizedText): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([reason, n]) => `${REASON_LABEL[reason]?.[locale] ?? reason}: ${n}`)
  return parts.join(', ')
}

function localizedDigestTitle(count: number): LocalizedText {
  return {
    'uz-Latn': `Kunlik xulosa: ${count} ta yangilanish`,
    'uz-Cyrl': `Кунлик хулоса: ${count} та янгиланиш`,
    ru: `Дневная сводка: ${count} обновлений`,
    en: `Daily summary: ${count} update(s)`,
  }
}

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
      // nosemgrep: query-in-loop -- see this file's header comment above.
      await notifyUser(log, {
        userId,
        type: 'notifications.digest.daily',
        reason: 'digest',
        subjectType: 'digest',
        subjectId: `daily-${new Date().toISOString().slice(0, 10)}`,
        departmentId,
        title: localizedDigestTitle(total),
        body: {
          'uz-Latn': summarizeCounts(counts, 'uz-Latn'),
          'uz-Cyrl': summarizeCounts(counts, 'uz-Cyrl'),
          ru: summarizeCounts(counts, 'ru'),
          en: summarizeCounts(counts, 'en'),
        },
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
    const text = `Haftalik xulosa / Weekly summary: ${summarizeCounts(totals, 'uz-Latn')}`
    try {
      // nosemgrep: query-in-loop -- see this file's header comment above.
      await bot.api.sendMessage(group.chatId, text)
    } catch (err) {
      log.warn({ err, chatId: group.chatId }, 'notifications: weekly department digest send failed')
    }
  }
}

export type JobRunnerHandle = { stop(): Promise<void> }

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

    await boss.createQueue(QUEUE_REMINDER_DUE).catch(() => {})
    await boss.createQueue(QUEUE_DIGEST_PERSONAL).catch(() => {})
    await boss.createQueue(QUEUE_DIGEST_DEPARTMENT).catch(() => {})

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

    log.info(
      'notifications: pg-boss job runner started (reminder.due hourly, digest.personal 08:30, digest.department Fri 18:00, Asia/Tashkent)',
    )
    return { stop: () => boss.stop({ graceful: true }) }
  } catch (err) {
    log.error(
      { err },
      'notifications: pg-boss job runner failed to start -- reminders/digests are disabled until the next boot',
    )
    return null
  }
}

export const _internal = { runReminderDue, runDigestPersonal, runDigestDepartment, summarizeCounts }

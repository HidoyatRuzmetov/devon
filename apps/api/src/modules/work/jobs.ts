// v1.1 SPEC §7 -- the two background jobs the work module owns: the recurring-card generator (A7)
// and the card-reminder sender (7.4).
//
// Both run on pg-boss, started from this module's own plugin body and never from `app.ts`
// (MODULE-GUIDE.md: `app.ts` is never edited to add a module) and never under `NODE_ENV=test`
// (the `unit` gate has no Postgres). The same shape `notifications/jobs.ts` and
// `analytics/aggregate.ts` already use, for the same reasons.
import type { FastifyBaseLogger } from 'fastify'
import { PgBoss } from 'pg-boss'
import { nextOccurrence, recurrenceRuleSchema, type RecurrenceRule } from '@devon/contracts'
import type { RequestContext } from '@devon/db'
import { notifyUser } from '../notifications/notify.js'
import * as plus from './plus-repo.js'
import * as repo from './repo.js'

const TZ = 'Asia/Tashkent'
export const QUEUE_RECURRENCE = 'work.recurrence'
export const QUEUE_REMINDERS = 'work.reminders'

/** One tick claims at most this many reminders, so a backlog drains over several minutes instead of
 * holding one transaction open across hundreds of Telegram sends. */
const REMINDER_BATCH = 100

/** Instance-level, department-less: both jobs' first question is "across every department, what is
 * due?", which no single department's lens can answer. Mirrors `analytics/aggregate.ts`'s own
 * nightly context; every *write* below runs under a per-department context built from the row it
 * found. */
function scanContext(): RequestContext {
  return {
    requestId: `work-jobs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: null,
    actorRole: 'super_admin',
    departmentId: null,
    departmentRole: null,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-work/jobs',
  }
}

function departmentContext(departmentId: string, userId: string | null): RequestContext {
  return {
    requestId: `work-jobs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    actorRole: null,
    departmentId,
    departmentRole: 'head',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-work/jobs',
  }
}

/**
 * Should this series produce its next instance now, and when is that instance due?
 *
 * The two modes are the whole design (see `recurrenceModeSchema`'s own comment):
 *  - `after_done` waits for the current instance to be finished and counts from that moment, which
 *    is right for "review the register every 30 days".
 *  - `schedule` counts from the current instance's own due date regardless, which is right for
 *    "the weekly report is due every Friday" -- missing one week must not move the next one.
 *
 * Returns `null` when nothing should be created: the rule has run out, the current instance is
 * still open under `after_done`, a newer instance already exists, or the next occurrence is still
 * in the future.
 */
export function nextInstanceDueAt(
  rule: RecurrenceRule,
  card: {
    status: 'active' | 'done' | 'archived'
    dueAt: string | null
    doneAt: string | null
    seriesCount: number
    hasNewerInstance: boolean
  },
  now: Date = new Date(),
): Date | null {
  if (card.hasNewerInstance) return null
  if (rule.mode === 'after_done' && card.status === 'active') return null

  const anchorIso =
    rule.mode === 'after_done' ? (card.doneAt ?? card.dueAt) : (card.dueAt ?? card.doneAt)
  if (!anchorIso) return null
  const next = nextOccurrence(rule, new Date(anchorIso), card.seriesCount)
  if (next === null) return null
  // `schedule` creates the next card as soon as the previous one's date has passed; `after_done`
  // creates it the moment the previous one is finished, which is what "every 30 days after you do
  // it" means to the person doing it.
  if (rule.mode === 'schedule' && next.getTime() > now.getTime()) return null
  return next
}

/** Keeps the time of day from the previous instance, so "every Friday at 09:00" stays at 09:00. */
function withTimeOfDay(date: Date, sourceIso: string | null): string {
  if (!sourceIso) {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        4, // 09:00 Asia/Tashkent
        0,
        0,
        0,
      ),
    ).toISOString()
  }
  const source = new Date(sourceIso)
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      source.getUTCHours(),
      source.getUTCMinutes(),
      0,
      0,
    ),
  ).toISOString()
}

export async function runRecurrenceScan(log: FastifyBaseLogger): Promise<number> {
  const cards = await plus.listRecurringCards(scanContext())
  let created = 0
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i]!
    const parsed = recurrenceRuleSchema.safeParse(card.recurrence)
    if (!parsed.success) continue
    const due = nextInstanceDueAt(parsed.data, card)
    if (due === null) continue
    try {
      // Sequential on purpose: each instance is a write the *next* iteration's "has a newer
      // instance already?" answer depends on, so running them concurrently could let one series
      // produce two cards. A background tick, not a request path.
      await repo.createCard(departmentContext(card.departmentId, card.createdByUserId), {
        departmentId: card.departmentId,
        title: card.title,
        description: card.description?.text,
        kind: card.kind,
        assigneeUserId: card.assigneeUserId,
        giverUserId: card.giverUserId,
        priority: card.priority,
        startAt: null,
        dueAt: withTimeOfDay(due, card.dueAt),
        labels: card.labels,
        links: [],
        projectId: card.projectId,
        projectScope: card.projectScope,
        orderKey: undefined,
        createdByUserId: card.createdByUserId,
        estimateMin: card.estimateMin,
        // The new instance carries the rule forward and the series pointer back, so the series is a
        // chain rather than a set of unrelated copies -- that is what makes "edit the series" and
        // "edit this instance" two different, answerable questions.
        recurrence: parsed.data,
        recurrenceSeriesId: card.recurrenceSeriesId ?? card.id,
        recurrenceIndex: (card.recurrenceIndex ?? 1) + 1,
        source: 'template',
      })
      created += 1
    } catch (err) {
      log.error({ err, cardId: card.id }, 'work: recurring card creation failed')
    }
  }
  if (created > 0) log.info({ created }, 'work: recurring cards created')
  return created
}

export async function runReminderScan(log: FastifyBaseLogger): Promise<number> {
  const due = await plus.claimDueReminders(scanContext(), REMINDER_BATCH)
  if (due.length === 0) return 0
  // Independent sends: one slow Telegram call must not hold up the other ninety-nine, and
  // `notifyUser` is already the one place channel fan-out and quiet hours are decided.
  const results = await Promise.allSettled(
    due.map((reminder) =>
      notifyUser(log, {
        userId: reminder.userId,
        type: 'work.card.reminder',
        reason: 'due',
        subjectType: 'card',
        subjectId: reminder.cardId,
        departmentId: reminder.departmentId,
        // Four locales written out in full -- see `notifications/registry.ts`'s own note on why a
        // template with a slot is not a translation across two scripts and Russian.
        title: {
          'uz-Latn': 'Eslatma',
          'uz-Cyrl': 'Эслатма',
          ru: 'Напоминание',
          en: 'Reminder',
        },
        body: {
          'uz-Latn': reminder.note
            ? `«${reminder.cardTitle}» — ${reminder.note}`
            : `«${reminder.cardTitle}» boʻyicha eslatma.`,
          'uz-Cyrl': reminder.note
            ? `«${reminder.cardTitle}» — ${reminder.note}`
            : `«${reminder.cardTitle}» бўйича эслатма.`,
          ru: reminder.note
            ? `«${reminder.cardTitle}» — ${reminder.note}`
            : `Напоминание по карточке «${reminder.cardTitle}».`,
          en: reminder.note
            ? `"${reminder.cardTitle}" — ${reminder.note}`
            : `A reminder about "${reminder.cardTitle}".`,
        },
        deepLink: `/work/card?id=${reminder.cardId}`,
      }),
    ),
  )
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed > 0) log.warn({ failed }, 'work: some card reminders could not be delivered')
  return due.length - failed
}

export type WorkJobsHandle = { stop(): Promise<unknown> }

/** Starts pg-boss and schedules both jobs. Any construction/start failure is caught and logged, not
 * thrown -- a scheduler that cannot reach Postgres yet must never fail the whole API's boot. */
export async function startWorkJobs(
  databaseUrl: string,
  log: FastifyBaseLogger,
): Promise<WorkJobsHandle | null> {
  try {
    const boss = new PgBoss(databaseUrl)
    boss.on('error', (err: unknown) => log.error({ err }, 'work: pg-boss reported an error'))
    await boss.start()
    await boss.createQueue(QUEUE_RECURRENCE).catch(() => {})
    await boss.createQueue(QUEUE_REMINDERS).catch(() => {})
    await boss.work(QUEUE_RECURRENCE, async () => {
      await runRecurrenceScan(log)
    })
    await boss.work(QUEUE_REMINDERS, async () => {
      await runReminderScan(log)
    })
    // Every quarter hour for the series generator (a card that appears fifteen minutes late is
    // indistinguishable from one that appeared on time), every minute for reminders (a reminder
    // that is fifteen minutes late is a reminder nobody trusts again).
    await boss.schedule(QUEUE_RECURRENCE, '*/15 * * * *', null, { tz: TZ })
    await boss.schedule(QUEUE_REMINDERS, '* * * * *', null, { tz: TZ })
    log.info('work: recurrence (15 min) and reminder (1 min) jobs scheduled')
    return { stop: () => boss.stop({ graceful: true }) }
  } catch (err) {
    log.error(
      { err },
      'work: job runner failed to start -- recurring cards and reminders are idle until the next boot',
    )
    return null
  }
}

import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { isMaintenanceActive } from '../notifications/repo.js'
import { isTelegramConfigured, publicUrl, sendPlainMessage } from '../telegram/transport.js'

const system: RequestContext = {
  requestId: 'personal-calendar-scheduler',
  userId: null,
  actorRole: 'super_admin',
  departmentId: null,
  departmentRole: null,
  actingForUserId: null,
  viewAs: false,
  ip: '127.0.0.1',
  userAgent: 'devon-personal-calendar/scheduler',
}
const labels = {
  en: 'Your personal calendar reminder',
  'uz-Latn': 'Shaxsiy taqvim eslatmangiz',
  'uz-Cyrl': 'Шахсий тақвим эслатмангиз',
  ru: 'Напоминание из личного календаря',
}
export async function processPersonalCalendarReminders(
  send = sendPlainMessage,
  configured = isTelegramConfigured,
) {
  if (!configured() || (await isMaintenanceActive())) return
  // nosemgrep: devon-query-in-loop -- Bounded leased jobs must be read and acknowledged in each owner's RLS scope.
  for (let index = 0; index < 30; index += 1) {
    const token = randomUUID()
    // This global queue contains pointers only. Private rows are read under their owner's context.
    // nosemgrep: query-in-loop
    const job = await withContext(system, async (tx) => {
      // nosemgrep: query-in-loop -- Claim one pointer before entering its owner's private transaction.
      const rows = await tx.raw<{
        entry_id: string
        user_id: string
        entry_version: number
      }>(sql`with candidate as(
        select entry_id from app.personal_calendar_reminders where sent_at is null and fire_at<=now() and fire_at>now()-interval '1 day'
          and attempts<8 and (lease_until is null or lease_until<now()) order by fire_at limit 1 for update skip locked)
        update app.personal_calendar_reminders q set lease_token=${token},lease_until=now()+interval '5 minutes',attempts=attempts+1
        from candidate c where q.entry_id=c.entry_id returning q.entry_id,q.user_id,q.entry_version`)
      return rows[0]
    })
    if (!job) break
    // The entry and delivery pointer stay locked through the bounded send. A simultaneous delete
    // or reminder reschedule cannot race a stale reminder into Telegram after that edit completes.
    // nosemgrep: query-in-loop
    await withContext(
      { ...system, requestId: token, userId: job.user_id, actorRole: 'member' },
      async (tx) => {
        // nosemgrep: query-in-loop -- This owner-only row lock prevents a concurrent edit racing the send.
        const entries = await tx.raw<{
          starts_at: Date
        }>(sql`select starts_at from app.personal_calendar_entries where id=${job.entry_id} and user_id=${job.user_id}
        and version=${job.entry_version} and deleted_at is null and remind_at<=now() for update`)
        if (!entries.length) return
        // nosemgrep: query-in-loop -- Validate the claimed receipt after locking its owner entry.
        const queues = await tx.raw(
          sql`select entry_id from app.personal_calendar_reminders where entry_id=${job.entry_id} and lease_token=${token} and entry_version=${job.entry_version} and sent_at is null for update`,
        )
        if (!queues.length) return
        // nosemgrep: query-in-loop -- Resolve this owner's current opt-in only after the locked receipt is validated.
        const targets = await tx.raw<{
          chat_id: string
          locale: string
        }>(sql`select l.chat_id,coalesce(u.locale,'uz-Latn') as locale from app.telegram_links l join app.users u on u.id=l.user_id
        where l.user_id=${job.user_id} and l.unlinked_at is null and (l.muted_until is null or l.muted_until<=now()) and u.deleted_at is null`)
        const target = targets[0]
        if (!target) return
        // Use a pointer, not private entry text, in the external message.
        const label = labels[target.locale as keyof typeof labels] ?? labels['uz-Latn']
        const month = new Date(entries[0]!.starts_at.getTime() + 5 * 3600000)
          .toISOString()
          .slice(0, 7)
        // nosemgrep: query-in-loop -- The locked entry and receipt must remain current through this bounded send.
        const sent = await send(
          target.chat_id,
          `${label}\n${publicUrl().replace(/\/+$/, '')}/personal?tab=calendar&month=${month}&entry=${job.entry_id}`,
        ).catch(() => ({ ok: false as const, error: 'telegram_send_failed' }))
        if (sent.ok) {
          // nosemgrep: query-in-loop -- Acknowledge only this successfully sent receipt before the next queue claim.
          await tx.raw(
            sql`update app.personal_calendar_reminders set sent_at=now(),lease_until=null where entry_id=${job.entry_id} and lease_token=${token}`,
          )
          tx.audit({
            action: 'personal.calendar.reminder_sent',
            subjectType: 'personal_calendar_entry',
            subjectId: job.entry_id,
          })
        }
      },
    )
  }
}
export function startPersonalCalendarWorker(onError: (error: unknown) => void) {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void processPersonalCalendarReminders()
      .catch(onError)
      .finally(() => {
        running = false
      })
  }
  const timer = setInterval(tick, 30_000)
  timer.unref?.()
  tick()
  return { stop: () => clearInterval(timer) }
}

import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { isMaintenanceActive, listAllDepartmentIds } from '../notifications/repo.js'
import { isTelegramConfigured, sendPlainMessage } from '../telegram/transport.js'
import { birthdayClock, birthdayInYear, nextDay } from './calendar.js'
import { ensureGreeting } from './repo.js'

function workerContext(departmentId: string, userId: string | null = null): RequestContext {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: 'super_admin',
    departmentId,
    departmentRole: 'head',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'devon-birthdays/scheduler',
  }
}

/** Only explicit no-send failures may retry. A timeout could already have delivered a message. */
export function birthdaySendDisposition(error: string): 'pending' | 'failed' | 'uncertain' {
  if (/telegram_not_configured|telegram_unavailable|429|Too Many Requests/i.test(error))
    return 'pending'
  if (/400:|403:|bot was blocked|chat not found|user is deactivated/i.test(error)) return 'failed'
  return 'uncertain'
}

export async function processBirthdays(
  send = sendPlainMessage,
  configured = isTelegramConfigured,
  now = new Date(),
  prepare = ensureGreeting,
) {
  const clock = birthdayClock(now)
  if (clock.hour < 9 || !configured() || (await isMaintenanceActive())) return
  const tomorrow = nextDay(clock.date)
  const departments = await listAllDepartmentIds()
  // nosemgrep: devon-query-in-loop -- Each tenant has an independent RLS transaction and bounded roster.
  for (let departmentIndex = 0; departmentIndex < departments.length; departmentIndex++) {
    const departmentId = departments[departmentIndex]!
    const ctx = workerContext(departmentId)
    // nosemgrep: query-in-loop
    const members = await withContext(ctx, async (tx) =>
      tx.raw<{ userId: string; date: string }>(sql`
      select m.user_id as "userId",b.birth_date::text as date from app.memberships m
      join app.account_birthdays b on b.owner_user_id=m.user_id
      join app.users u on u.id=m.user_id and u.status='active' and u.deleted_at is null
      where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null`),
    )
    const birthdays = members.filter(
      (member) => birthdayInYear(member.date, Number(tomorrow.slice(0, 4))) === tomorrow,
    )
    await Promise.all(
      birthdays.map((member) =>
        withContext(ctx, (tx) =>
          tx.raw(sql`insert into app.birthday_reminders(department_id,owner_user_id,head_user_id,celebration_date)
          select ${departmentId},${member.userId},m.user_id,${tomorrow}::date from app.memberships m
          where m.department_id=${departmentId} and m.role='head' and m.status='active' and m.deleted_at is null
          on conflict(department_id,owner_user_id,head_user_id,birthday_year) do update
            set celebration_date=excluded.celebration_date
            where app.birthday_reminders.status='pending'`),
        ),
      ),
    )
    // nosemgrep: devon-query-in-loop -- Claim and acknowledge each external send before selecting the next.
    for (let n = 0; n < 30; n++) {
      const token = randomUUID()
      // nosemgrep: query-in-loop
      const delivery = await withContext(ctx, async (tx) => {
        // nosemgrep: query-in-loop -- Claim one lease, send, and durably acknowledge it before claiming the next delivery.
        const [row] = await tx.raw<{
          id: string
          ownerUserId: string
          headUserId: string
          chatId: string
          name: string
        }>(sql`
          with candidate as (
            select q.id,l.chat_id::text as chat_id,u.given_name||' '||u.family_name as name
            from app.birthday_reminders q
            join app.memberships h on h.department_id=q.department_id and h.user_id=q.head_user_id and h.role='head' and h.status='active' and h.deleted_at is null
            join app.memberships m on m.department_id=q.department_id and m.user_id=q.owner_user_id and m.status='active' and m.deleted_at is null
            join app.users u on u.id=q.owner_user_id and u.deleted_at is null and u.status='active'
            join app.users hu on hu.id=q.head_user_id and hu.deleted_at is null and hu.status='active'
            join app.account_birthdays b on b.owner_user_id=q.owner_user_id
            join app.telegram_links l on l.user_id=q.head_user_id and l.unlinked_at is null
            where (q.status='pending' or (q.status='preparing' and q.lease_until<${now.toISOString()}::timestamptz)) and q.attempts<5 and q.celebration_date=${tomorrow}::date
              and (q.retry_at is null or q.retry_at<=${now.toISOString()}::timestamptz)
              and (to_char(b.birth_date,'MM-DD')=to_char(q.celebration_date,'MM-DD')
                or (to_char(b.birth_date,'MM-DD')='02-29' and to_char(q.celebration_date,'MM-DD')='02-28'
                  and extract(day from (date_trunc('month',q.celebration_date)+interval '1 month - 1 day'))=28))
            order by q.id limit 1 for update of q skip locked
          ) update app.birthday_reminders q set status='preparing',attempts=attempts+1,lease_token=${token},lease_until=${now.toISOString()}::timestamptz+interval '2 minutes'
            from candidate c where q.id=c.id
            returning q.id,q.owner_user_id as "ownerUserId",q.head_user_id as "headUserId",c.chat_id as "chatId",c.name`)
        return row
      })
      if (!delivery) break
      // nosemgrep: query-in-loop
      const message = await prepare(
        workerContext(departmentId, delivery.headUserId),
        delivery.ownerUserId,
        tomorrow,
      )
      // Commit the no-replay receipt immediately before the external side effect, after preparation.
      // nosemgrep: query-in-loop
      const claimed = await withContext(ctx, async (tx) =>
        tx.raw(sql`update app.birthday_reminders q set status='sending',lease_until=null
        where q.id=${delivery.id} and q.status='preparing' and q.lease_token=${token}
          and q.celebration_date=${tomorrow}::date
          and exists(select 1 from app.memberships h join app.telegram_links l on l.user_id=h.user_id
            join app.users hu on hu.id=h.user_id and hu.status='active' and hu.deleted_at is null
            where h.department_id=q.department_id and h.user_id=q.head_user_id and h.role='head' and h.status='active' and h.deleted_at is null
              and l.chat_id::text=${delivery.chatId} and l.unlinked_at is null)
          and exists(select 1 from app.memberships m join app.users u on u.id=m.user_id
            join app.account_birthdays b on b.owner_user_id=m.user_id
            where m.department_id=q.department_id and m.user_id=q.owner_user_id and m.status='active' and m.deleted_at is null
              and u.status='active' and u.deleted_at is null
              and (to_char(b.birth_date,'MM-DD')=to_char(q.celebration_date,'MM-DD')
                or (to_char(b.birth_date,'MM-DD')='02-29' and to_char(q.celebration_date,'MM-DD')='02-28'
                  and extract(day from (date_trunc('month',q.celebration_date)+interval '1 month - 1 day'))=28))) returning q.id`),
      )
      if (!claimed.length) {
        // nosemgrep: query-in-loop -- Only this preparation's token can retire a now-invalid delivery.
        await withContext(ctx, (tx) =>
          tx.raw(sql`update app.birthday_reminders set status='failed',lease_until=null
          where id=${delivery.id} and status='preparing' and lease_token=${token}`),
        )
        continue
      }
      // nosemgrep: query-in-loop
      const result = await send(
        delivery.chatId,
        `Tomorrow is ${delivery.name}'s birthday.\n\nA message you can share:\n\nHappy birthday! ${message}\n\nFrom the team`,
      ).catch(() => ({ ok: false as const, error: 'delivery_uncertain' }))
      const status = result.ok ? 'sent' : birthdaySendDisposition(result.error)
      // nosemgrep: query-in-loop
      await withContext(ctx, async (tx) => {
        // nosemgrep: query-in-loop -- Persist this external send's receipt before its audit and the next claim; never replay an uncertain send.
        await tx.raw(sql`update app.birthday_reminders set status=${status},
          sent_at=${result.ok ? now.toISOString() : null}::timestamptz,
          telegram_message_id=${result.ok ? result.messageId : null},
          retry_at=${now.toISOString()}::timestamptz+interval '5 minutes' where id=${delivery.id} and lease_token=${token}`)
        tx.audit({
          action: 'birthdays.reminder_delivery',
          subjectType: 'user',
          subjectId: delivery.ownerUserId,
          after: { status, date: tomorrow },
        })
      })
    }
  }
}

export function startBirthdayWorker(onError: (error: unknown) => void) {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void processBirthdays()
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

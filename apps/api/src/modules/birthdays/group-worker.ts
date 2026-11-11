import { withContext, type RequestContext } from '@devon/db'
import { sql, type SQL } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { isMaintenanceActive, listAllDepartmentIds } from '../notifications/repo.js'
import { isTelegramConfigured, sendPlainMessage } from '../telegram/transport.js'
import { birthdayClock, birthdayInYear } from './calendar.js'
import { birthdaySendDisposition, birthdayWorkerContext } from './delivery.js'
import { prepareGroupBirthday } from './group-greeting.js'

const FIRST_PUBLIC_BIRTHDAY_DATE = '2026-11-12'

const deliveryErrors = {
  sent: null,
  pending: 'telegram_retry',
  failed: 'delivery_failed',
  uncertain: 'delivery_uncertain',
} as const

/** Project only the employee's identity and subscribed chat. Re-run this exact selection after AI preparation. */
function groupRecipients(departmentId: string, date: string) {
  const anniversaries = [date.slice(5)]
  if (date.endsWith('-02-28') && birthdayInYear('2000-02-29', Number(date.slice(0, 4))) === date)
    anniversaries.push('02-29')
  return sql`select m.user_id, u.given_name, g.chat_id
    from app.memberships m
    join app.departments d on d.id=m.department_id and d.status='active' and d.deleted_at is null
    join app.users u on u.id=m.user_id and u.status='active' and u.deleted_at is null
    join app.account_birthdays b on b.owner_user_id=u.id
    join app.telegram_groups g on g.department_id=d.id and g.disconnected_at is null and 'announcements'=any(g.kinds)
    where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null
      and to_char(b.birth_date,'MM-DD')=any(${sql.param(anniversaries)}::text[])`
}

function activeHeads(departmentId: string) {
  return sql`select h.user_id from app.memberships h
    join app.users u on u.id=h.user_id and u.status='active' and u.deleted_at is null
    where h.department_id=${departmentId} and h.role='head' and h.status='active' and h.deleted_at is null`
}

async function queueToday(ctx: RequestContext, recipients: SQL, date: string, now: string) {
  await withContext(ctx, async (tx) => {
    // If the sender died after crossing the network boundary there is no safe automatic replay.
    await tx.raw(sql`update app.telegram_birthday_deliveries set status='uncertain',last_error='delivery_uncertain',lease_until=null
      where department_id=${ctx.departmentId} and status='sending' and lease_until<=${now}::timestamptz`)
    await tx.raw(sql`with recipients as (${recipients})
      insert into app.telegram_birthday_deliveries as q (department_id,owner_user_id,chat_id,celebration_date)
      select ${ctx.departmentId},user_id,chat_id,${date}::date from recipients
      on conflict(department_id,chat_id,owner_user_id,celebration_year) do update
        set celebration_date=excluded.celebration_date,status='pending',attempts=0,retry_at=null,lease_token=null,lease_until=null,last_error=null,source=null
        where q.celebration_date<>excluded.celebration_date and q.status in ('pending','preparing','failed')`)
  })
}

async function reserve(
  ctx: RequestContext,
  recipients: SQL,
  heads: SQL,
  date: string,
  now: string,
  token: string,
) {
  return withContext(ctx, async (tx) => {
    const [row] = await tx.raw<{ id: string; ownerId: string; headId: string; chatId: string }>(sql`
      with recipients as (${recipients}), head as (${heads} order by h.user_id limit 1),
      candidate as (
        select q.id,h.user_id as head_id from app.telegram_birthday_deliveries q
        join recipients r on r.user_id=q.owner_user_id and r.chat_id=q.chat_id
        cross join head h
        where q.department_id=${ctx.departmentId} and q.celebration_date=${date}::date
          and (q.status='pending' or (q.status='preparing' and q.lease_until<=${now}::timestamptz))
          and (q.retry_at is null or q.retry_at<=${now}::timestamptz)
        order by q.id limit 1 for update of q skip locked
      )
      update app.telegram_birthday_deliveries q set status='preparing',attempts=attempts+1,lease_token=${token},
        lease_until=${now}::timestamptz+interval '2 minutes',retry_at=null
      from candidate c where q.id=c.id
      returning q.id,q.owner_user_id as "ownerId",c.head_id as "headId",q.chat_id::text as "chatId"`)
    return row
  })
}

async function deferPreparation(
  ctx: RequestContext,
  id: string,
  token: string,
  now: string,
  reason: 'preparation_failed' | 'recipient_changed',
) {
  await withContext(ctx, (tx) =>
    tx.raw(sql`update app.telegram_birthday_deliveries set status='pending',lease_until=null,
    retry_at=${now}::timestamptz+interval '5 minutes',last_error=${reason}
    where id=${id} and lease_token=${token} and status='preparing'`),
  )
}

export async function processGroupBirthdays(
  send = sendPlainMessage,
  configured = isTelegramConfigured,
  now: Date | (() => Date) = () => new Date(),
  prepare = prepareGroupBirthday,
) {
  const readNow = typeof now === 'function' ? now : () => now
  const start = readNow()
  const { date, hour } = birthdayClock(start)
  if (
    date < FIRST_PUBLIC_BIRTHDAY_DATE ||
    hour < 9 ||
    !configured() ||
    (await isMaintenanceActive())
  )
    return
  const departments = await listAllDepartmentIds()
  // nosemgrep: devon-query-in-loop -- Each department requires its own RLS context for its receipts.
  for (let index = 0; index < departments.length; index++) {
    const departmentId = departments[index]!
    const ctx = birthdayWorkerContext(departmentId)
    const recipients = groupRecipients(departmentId, date),
      heads = activeHeads(departmentId)
    // nosemgrep: query-in-loop -- Each tenant is processed under its own constrained database context.
    await queueToday(ctx, recipients, date, start.toISOString())
    // nosemgrep: devon-query-in-loop -- Record the outcome of each Telegram send before claiming the next.
    for (let count = 0; count < 30; count++) {
      const token = randomUUID(),
        current = readNow()
      if (birthdayClock(current).date !== date) return
      // nosemgrep: query-in-loop -- Lease one external send at a time so a slow AI call cannot strand a batch.
      const delivery = await reserve(ctx, recipients, heads, date, current.toISOString(), token)
      if (!delivery) break
      let greeting: Awaited<ReturnType<typeof prepare>>
      try {
        // nosemgrep: query-in-loop -- Prepare the public message for this leased destination.
        greeting = await prepare(
          birthdayWorkerContext(departmentId, delivery.headId),
          delivery.ownerId,
        )
      } catch {
        // nosemgrep: query-in-loop -- Provider failures happened before Telegram could receive anything.
        await deferPreparation(
          ctx,
          delivery.id,
          token,
          readNow().toISOString(),
          'preparation_failed',
        )
        continue
      }
      const ready = readNow()
      if (birthdayClock(ready).date !== date) return
      // nosemgrep: query-in-loop -- Commit the no-replay boundary only after rechecking membership, date and subscription.
      const [recipient] = await withContext(ctx, (tx) =>
        tx.raw<{ name: string }>(sql`
        with recipients as (${recipients}), heads as (${heads})
        update app.telegram_birthday_deliveries q set status='sending',source=${greeting.source},last_error=null,
          lease_until=${ready.toISOString()}::timestamptz+interval '2 minutes'
        from recipients r where q.id=${delivery.id} and q.status='preparing' and q.lease_token=${token}
          and q.celebration_date=${date}::date and r.user_id=q.owner_user_id and r.chat_id=q.chat_id
          and exists(select 1 from heads where user_id=${delivery.headId})
        returning r.given_name as name`),
      )
      if (!recipient) {
        // nosemgrep: query-in-loop -- A changed recipient may become eligible again later today.
        await deferPreparation(ctx, delivery.id, token, ready.toISOString(), 'recipient_changed')
        continue
      }
      // nosemgrep: query-in-loop -- Send only after this delivery's durable no-replay receipt is committed.
      const result = await send(
        delivery.chatId,
        `Happy birthday, ${recipient.name}! 🎉\n\n${greeting.message}\n\nFrom the team`,
      ).catch(() => ({ ok: false as const, error: 'delivery_uncertain' }))
      const status = result.ok ? 'sent' : birthdaySendDisposition(result.error)
      const finishedAt = readNow().toISOString()
      // nosemgrep: query-in-loop -- Persist the outcome before taking another delivery.
      await withContext(ctx, async (tx) => {
        // nosemgrep: query-in-loop -- Record Telegram's exact result in this delivery's transaction.
        await tx.raw(sql`update app.telegram_birthday_deliveries set status=${status},lease_until=null,
          sent_at=${result.ok ? finishedAt : null}::timestamptz,telegram_message_id=${result.ok ? result.messageId : null},
          retry_at=case when ${status}='pending' then ${finishedAt}::timestamptz+interval '5 minutes' end,
          last_error=${deliveryErrors[status]}
          where id=${delivery.id} and lease_token=${token} and status in ('sending','uncertain')`)
        tx.audit({
          action: 'birthdays.group_delivery',
          subjectType: 'user',
          subjectId: delivery.ownerId,
          after: { status, date, source: greeting.source },
        })
      })
    }
  }
}

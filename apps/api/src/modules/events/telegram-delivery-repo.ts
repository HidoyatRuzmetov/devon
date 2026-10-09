import { randomUUID } from 'node:crypto'
import { withContext, type RequestContext, type OutboxEventRecord } from '@devon/db'
import { sql } from 'drizzle-orm'
import { getEventRow, getPoll } from './repo.js'

function context(departmentId: string | null): RequestContext {
  return {
    requestId: randomUUID(),
    userId: null,
    actorRole: 'super_admin',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '',
    userAgent: 'devon-events/telegram-delivery',
  }
}

export async function queueGroupDeliveries(
  event: OutboxEventRecord,
  eventId: string,
  kind: 'events' | 'polls',
  pollId: string | null,
): Promise<number> {
  return withContext(context(event.departmentId), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      insert into app.event_telegram_deliveries
        (department_id, source_event_id, event_id, poll_id, group_id, event_type, group_kind)
      select e.department_id, ${event.id}::uuid, e.id, ${pollId}::uuid, g.id, ${event.type}, ${kind}
      from app.events e join app.departments d on d.id = e.department_id
      join app.telegram_groups g on g.department_id = e.department_id
      where e.id = ${eventId}::uuid and e.department_id = ${event.departmentId}::uuid
        and e.deleted_at is null and g.disconnected_at is null
        and d.deleted_at is null and ${kind} = any(g.kinds)
      on conflict (source_event_id, group_id) do nothing returning id
    `)
    if (rows.length > 0) {
      tx.audit({
        action: 'events.telegram_group_queued',
        subjectType: 'event',
        subjectId: eventId,
        after: { sourceEventId: event.id, targets: rows.length },
      })
    }
    return rows.length
  })
}

export type GroupDelivery = {
  id: string
  department_id: string
  event_id: string
  poll_id: string | null
  group_id: string
  event_type: string
  group_kind: 'events' | 'polls'
  lease_token: string
  attempts: number
}

/** One row at a time so its 60-second lease covers the bounded 8-second send, regardless of batch
 * size. SKIP LOCKED + a lease token make concurrent workers and crash recovery independent. */
export async function claimGroupDelivery(): Promise<GroupDelivery | null> {
  return withContext(context(null), async (tx) => {
    const rows = await tx.raw<GroupDelivery>(sql`
      with candidate as (
        select q.id from app.event_telegram_deliveries q
        left join app.departments d on d.id = q.department_id
        where q.status = 'pending' and q.next_attempt_at <= now()
          and (q.leased_until is null or q.leased_until < now())
          and (d.status = 'active' or d.deleted_at is not null)
        order by q.created_at, q.id limit 1 for update of q skip locked
      )
      update app.event_telegram_deliveries q set
        lease_token = ${randomUUID()}::uuid, leased_until = now() + interval '60 seconds',
        attempts = attempts + 1
      from candidate c where q.id = c.id returning q.*
    `)
    return rows[0] ?? null
  })
}

export async function groupDeliveryPointer(delivery: GroupDelivery) {
  return withContext(context(delivery.department_id), async (tx) => {
    const targets = await tx.raw<{
      chat_id: string
      locale_default: string
      status: string
      maintenance: boolean
    }>(sql`
      select g.chat_id, d.locale_default, d.status,
        exists (select 1 from app.instance_settings s
          where s.id = 1 and s.maintenance->>'enabled' = 'true') as maintenance
      from app.telegram_groups g join app.departments d on d.id = g.department_id
      where g.id = ${delivery.group_id}::uuid and g.department_id = ${delivery.department_id}::uuid
        and g.disconnected_at is null and ${delivery.group_kind} = any(g.kinds)
        and d.deleted_at is null
    `)
    const target = targets[0]
    if (target && (target.status !== 'active' || target.maintenance))
      return { paused: true as const }
    const event = await getEventRow(tx, delivery.event_id)
    if (!target || !event) return null
    if (delivery.group_kind === 'polls') {
      if (!delivery.poll_id) return null
      const poll = await getPoll(tx, delivery.poll_id)
      if (!poll || poll.event_id !== event.id || poll.status !== 'open') return null
    }
    if (
      delivery.event_type !== 'events.event.cancelled' &&
      (event.status === 'cancelled' ||
        event.status === 'done' ||
        event.ends_at.getTime() < Date.now())
    ) {
      return null
    }
    return { chatId: target.chat_id, locale: target.locale_default, event }
  })
}

export async function finishGroupDelivery(
  delivery: GroupDelivery,
  result: { status: 'sent' | 'skipped' | 'pending' | 'failed'; messageId?: number; error?: string },
): Promise<void> {
  await withContext(context(delivery.department_id), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.event_telegram_deliveries set status = ${result.status},
        message_id = ${result.messageId ?? null}, last_error = ${result.error ?? null},
        completed_at = case when ${result.status} <> 'pending' then now() else null end,
        next_attempt_at = now() + (${Math.min(3600, 30 * 2 ** (delivery.attempts - 1))} * interval '1 second'),
        lease_token = null, leased_until = null
      where id = ${delivery.id}::uuid and lease_token = ${delivery.lease_token}::uuid returning id
    `)
    if (rows.length > 0)
      tx.audit({
        action: 'events.telegram_group_delivery',
        subjectType: 'event',
        subjectId: delivery.event_id,
        after: { groupId: delivery.group_id, status: result.status, attempts: delivery.attempts },
      })
  })
}

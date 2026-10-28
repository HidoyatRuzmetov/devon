import type { PersonalCalendarInput, PersonalCalendarItem } from '@devon/contracts'
import { withContext, type RequestContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

export async function listCalendar(
  ctx: RequestContext,
  from: string,
  to: string,
): Promise<PersonalCalendarItem[]> {
  const start = `${from}T00:00:00+05:00`,
    end = `${to}T00:00:00+05:00`
  return withContext(ctx, async (tx) => {
    const personal =
      await tx.raw<PersonalCalendarItem>(sql`select id,'personal' as kind,title,notes,starts_at::text as "startsAt",ends_at::text as "endsAt",
      all_day as "allDay",remind_at::text as "remindAt",version,'active' as status,null::text as href
      from app.personal_calendar_entries where user_id=${ctx.userId} and deleted_at is null and starts_at<${end}::timestamptz and ends_at>=${start}::timestamptz order by starts_at,id`)
    if (!ctx.departmentId) return personal
    const tasks =
      await tx.raw<PersonalCalendarItem>(sql`select id,'task' as kind,title,'' as notes,due_at::text as "startsAt",due_at::text as "endsAt",
      true as "allDay",null::text as "remindAt",version,status::text,'/work/card?id='||id::text||'&from=personal' as href
      from app.cards where department_id=${ctx.departmentId} and assignee_user_id=${ctx.userId} and deleted_at is null
        and due_at>=${start}::timestamptz and due_at<${end}::timestamptz order by due_at,id`)
    const events =
      await tx.raw<PersonalCalendarItem>(sql`select e.id,'event' as kind,e.title,coalesce(e.place,'') as notes,e.starts_at::text as "startsAt",e.ends_at::text as "endsAt",
      false as "allDay",null::text as "remindAt",e.version,r.status::text,'/events?event='||e.id::text||'&from=personal' as href
      from app.events e join app.event_rsvps r on r.event_id=e.id and r.user_id=${ctx.userId} and r.status in ('yes','waitlist')
      where e.department_id=${ctx.departmentId} and e.deleted_at is null and e.status not in ('draft','cancelled')
        and e.starts_at<${end}::timestamptz and e.ends_at>=${start}::timestamptz order by e.starts_at,e.id`)
    return [...personal, ...tasks, ...events]
  })
}
export async function saveCalendar(
  ctx: RequestContext,
  input: PersonalCalendarInput,
  id?: string,
  version?: number,
) {
  return withContext(ctx, async (tx) => {
    const target = id ?? randomUUID()
    // An already-delivered reminder may remain on an edited entry. A newly selected reminder
    // must be in the future; lock the current version before comparing, so concurrent rescheduling
    // cannot turn a stale edit into a second delivery.
    if (id) {
      const current = await tx.raw<{ remind_at: Date | null; version: number }>(
        sql`select remind_at,version from app.personal_calendar_entries where id=${id} and user_id=${ctx.userId} and deleted_at is null for update`,
      )
      if (!current[0] || current[0].version !== version) return null
      if (
        input.remindAt &&
        Date.parse(input.remindAt) <= Date.now() &&
        current[0].remind_at?.getTime() !== Date.parse(input.remindAt)
      )
        return { error: 'reminder_in_past' as const }
    } else if (input.remindAt && Date.parse(input.remindAt) <= Date.now())
      return { error: 'reminder_in_past' as const }
    if (id) {
      const rows = await tx.raw<{
        id: string
      }>(sql`update app.personal_calendar_entries set title=${input.title},notes=${input.notes},starts_at=${input.startsAt},ends_at=${input.endsAt},
        all_day=${input.allDay},remind_at=${input.remindAt},version=version+1,updated_at=now() where id=${id} and user_id=${ctx.userId} and deleted_at is null and version=${version} returning id`)
      if (!rows.length) return null
    } else {
      await tx.raw(sql`insert into app.personal_calendar_entries(id,user_id,title,notes,starts_at,ends_at,all_day,remind_at)
        values(${target},${ctx.userId},${input.title},${input.notes},${input.startsAt},${input.endsAt},${input.allDay},${input.remindAt})`)
    }
    tx.audit({
      action: id ? 'personal.calendar.updated' : 'personal.calendar.created',
      subjectType: 'personal_calendar_entry',
      subjectId: target,
      after: { via: ctx.userAgent?.includes(' ai-action/') ? 'ai' : 'manual' },
    })
    tx.emit({ type: 'personal.calendar.changed', payload: { userId: ctx.userId, id: target } })
    return { id: target }
  })
}
export async function deleteCalendar(ctx: RequestContext, id: string, version: number) {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
    }>(sql`update app.personal_calendar_entries set deleted_at=now(),updated_at=now(),version=version+1
      where id=${id} and user_id=${ctx.userId} and version=${version} and deleted_at is null returning id`)
    if (!rows.length) return false
    tx.audit({
      action: 'personal.calendar.deleted',
      subjectType: 'personal_calendar_entry',
      subjectId: id,
    })
    tx.emit({ type: 'personal.calendar.changed', payload: { userId: ctx.userId, id } })
    return true
  })
}

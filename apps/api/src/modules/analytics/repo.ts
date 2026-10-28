// Private Home totals. Check-in reporting is owned by the checkins module.
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { sql } from 'drizzle-orm'
export type PersonalOverview = {
  openCount: number
  toDoCount: number
  inProgressCount: number
  doneCount: number
  archivedCount: number
  overdueCount: number
  doneThisWeek: number
  onTimeRate: number | null
  upcomingEventCount: number
  givenOverdueCount: number
}

async function personalOverview(
  tx: Tx,
  departmentId: string,
  viewerUserId: string,
): Promise<PersonalOverview> {
  const cardRows = await tx.raw<{
    open_count: string
    to_do_count: string
    in_progress_count: string
    done_count: string
    archived_count: string
    overdue_count: string
    done_this_week: string
    due_count: string
    on_time_count: string
  }>(sql`
    select
      count(*) filter (where status = 'active') as open_count,
      count(*) filter (where status = 'active' and work_stage = 'todo') as to_do_count,
      count(*) filter (where status = 'active' and work_stage = 'in_progress') as in_progress_count,
      count(*) filter (where status = 'done') as done_count,
      count(*) filter (where status = 'archived') as archived_count,
      count(*) filter (where status = 'active' and due_at is not null and due_at < now()) as overdue_count,
      count(*) filter (where status = 'done' and done_at >= now() - interval '7 days') as done_this_week,
      count(*) filter (where status = 'done' and done_at >= now() - interval '7 days' and due_at is not null) as due_count,
      count(*) filter (
        where status = 'done' and done_at >= now() - interval '7 days' and due_at is not null and done_at <= due_at
      ) as on_time_count
    from app.cards
    where department_id = ${departmentId} and deleted_at is null and assignee_user_id = ${viewerUserId}
  `)
  const c = cardRows[0]

  const upcomingRows = await tx.raw<{ count: string }>(sql`
    select count(*) as count from app.event_rsvps r
    join app.events e on e.id = r.event_id
    where r.user_id = ${viewerUserId} and r.status = 'yes' and e.starts_at >= now() and e.deleted_at is null
  `)

  // Home's "needs my decision" (TECH-SPEC §5): work the viewer *gave out* that is now overdue -- a
  // different count than `overdue_count` above (which is the viewer's own overdue assignments).
  const givenRows = await tx.raw<{ count: string }>(sql`
    select count(*) as count from app.cards
    where department_id = ${departmentId} and deleted_at is null and giver_user_id = ${viewerUserId}
      and status = 'active' and due_at is not null and due_at < now()
  `)

  const due = Number(c?.due_count ?? 0)
  const onTime = Number(c?.on_time_count ?? 0)
  return {
    openCount: Number(c?.open_count ?? 0),
    toDoCount: Number(c?.to_do_count ?? 0),
    inProgressCount: Number(c?.in_progress_count ?? 0),
    doneCount: Number(c?.done_count ?? 0),
    archivedCount: Number(c?.archived_count ?? 0),
    overdueCount: Number(c?.overdue_count ?? 0),
    doneThisWeek: Number(c?.done_this_week ?? 0),
    onTimeRate: due > 0 ? onTime / due : null,
    upcomingEventCount: Number(upcomingRows[0]?.count ?? 0),
    givenOverdueCount: Number(givenRows[0]?.count ?? 0),
  }
}

export function getPersonalOverview(ctx: RequestContext) {
  return withContext(ctx, (tx) => personalOverview(tx, ctx.departmentId!, ctx.userId!))
}

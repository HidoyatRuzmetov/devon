import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import { z } from 'zod'
import { AiInputValidationError } from './errors.js'
import { tashkentDate, tashkentToday } from './live-context.js'

/** Only a selected project or the caller's private tasks; the department briefing has its own
 * measured snapshot in briefing.ts. Totals remain complete while named examples stay compact. */
export async function prepareCatchUpContext(
  ctx: RequestContext,
  departmentId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const personal = input['scope'] === 'person' && input['privateWorkspace'] === true
  const project = input['scope'] === 'project' && input['projectId']
  if (!personal && !project) return input
  return withContext(ctx, async (tx) => {
    const selected = personal ? ctx.userId : z.uuid().safeParse(input['projectId']).data
    if (!selected) throw new AiInputValidationError('A valid catch-up subject is required')
    let subjectName: string
    if (personal) {
      const rows = await tx.raw<{ name: string }>(
        sql`select concat_ws(' ',given_name,family_name) as name from app.users where id=${selected}`,
      )
      subjectName = rows[0]?.name ?? 'Personal work'
    } else {
      const rows = await tx.raw<{ title: string }>(
        sql`select title from app.projects where id=${selected} and department_id=${departmentId} and deleted_at is null`,
      )
      if (!rows[0]) throw new AiInputValidationError('The referenced project is unavailable')
      subjectName = rows[0].title
    }
    const source = personal ? sql`app.personal_tasks` : sql`app.cards`
    const scope = personal
      ? sql`c.user_id=${selected}`
      : sql`c.project_id=${selected} and c.department_id=${departmentId}`
    const active = personal ? sql`c.done_at is null` : sql`c.status='active'`
    const due = personal ? sql`s.ends_at` : sql`c.due_at`
    const joins = personal
      ? sql`left join app.personal_sprints s on s.id=c.sprint_id`
      : sql`left join app.users u on u.id=c.assignee_user_id`
    const rows = await tx.raw<{
      id: string
      title: string
      doneAt: string | null
      createdAt: string
      dueDate: string | null
      daysOverdue: number
      daysSinceUpdate: number
      assigneeName: string | null
      isOverdue: boolean
    }>(sql`
      select c.id,c.title,c.done_at as "doneAt",c.created_at as "createdAt",to_char(${due} at time zone 'Asia/Tashkent','YYYY-MM-DD') as "dueDate",(${active} and ${due}<now()) as "isOverdue",
      greatest(0,floor(extract(epoch from now()-${due})/86400))::int as "daysOverdue",
      greatest(0,floor(extract(epoch from now()-c.updated_at)/86400))::int as "daysSinceUpdate",
      ${personal ? sql`null::text` : sql`nullif(concat_ws(' ',u.given_name,u.family_name),'')`} as "assigneeName"
      from ${source} c ${joins} where ${scope} and c.deleted_at is null and (${active} or c.done_at>now()-interval '7 days')
      order by (${active} and ${due}<now()) desc,${due} nulls last,c.updated_at desc,c.id limit 100`)
    const counts = await tx.raw<{
      done: number
      doneLastPeriod: number
      created: number
      overdue: number
    }>(sql`
      select count(*) filter(where c.done_at>now()-interval '7 days')::int as done,
      count(*) filter(where c.done_at<=now()-interval '7 days' and c.done_at>now()-interval '14 days')::int as "doneLastPeriod",
      count(*) filter(where c.created_at>now()-interval '7 days')::int as created,
      count(*) filter(where ${active} and ${due}<now())::int as overdue
      from ${source} c ${joins} where ${scope} and c.deleted_at is null`)
    const today = tashkentToday()
    const inWeek = tashkentDate(new Date(Date.now() + 7 * 86_400_000))
    const item = (c: (typeof rows)[number]) => ({
      id: c.id,
      title: c.title,
      assigneeName: c.assigneeName,
      dueDate: c.dueDate,
      daysOverdue: c.daysOverdue ?? 0,
      daysSinceUpdate: c.daysSinceUpdate,
    })
    return {
      ...input,
      window: 'week',
      subjectName,
      period: {
        start: tashkentDate(new Date(Date.now() - 7 * 86_400_000)),
        end: today,
      },
      counts: counts[0],
      done: rows
        .filter((c) => c.doneAt !== null)
        .slice(0, 20)
        .map(item),
      overdue: rows
        .filter((c) => c.isOverdue)
        .slice(0, 20)
        .map(item),
      dueThisWeek: rows
        .filter(
          (c) =>
            c.doneAt === null &&
            !c.isOverdue &&
            c.dueDate !== null &&
            c.dueDate >= today &&
            c.dueDate <= inWeek,
        )
        .slice(0, 20)
        .map(item),
      assignedToMe: personal
        ? rows
            .filter((c) => new Date(c.createdAt).getTime() > Date.now() - 7 * 86_400_000)
            .slice(0, 20)
            .map(item)
        : [],
      mentions: [],
      comments: [],
      loadPerPerson: [],
      eventsAhead: [],
    }
  })
}

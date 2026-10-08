import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { z } from 'zod'
import { glossaryFor } from '@devon/ai'
import { AiInputValidationError } from './errors.js'

export const tashkentToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString())
export const tashkentDate = (value: string | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
const age = (value: string | Date) =>
  Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000))
function recordId(value: unknown): string {
  const parsed = z.uuid().safeParse(value)
  if (!parsed.success) throw new AiInputValidationError('A valid record reference is required')
  return parsed.data
}
type LiveCard = {
  id: string
  title: string
  description: { text?: string } | null
  status: string
  priority: string
  due_at: string | null
  updated_at: string
  estimate_min: number | null
  assigneeName: string | null
  projectTitle: string | null
  labels: string[]
  checklist: { text: string; done: boolean }[]
  blockedBy: { id: string; title: string }[]
  commentCount: number
}
async function cardContext(tx: Tx, departmentId: string, id: string): Promise<LiveCard> {
  const rows = await tx.raw<LiveCard>(sql`
    select c.id,c.title,c.description,c.status,c.priority,c.due_at,c.updated_at,c.estimate_min,
      nullif(concat_ws(' ',u.given_name,u.family_name),'') as "assigneeName",p.title as "projectTitle",
      coalesce((select array_agg(l.name order by l.name) from app.labels l where l.id=any(c.labels) and l.deleted_at is null),'{}') as labels,
      coalesce((select jsonb_agg(jsonb_build_object('text',i.text,'done',i.done_at is not null) order by i.order_key,i.created_at,i.id)
        from app.card_checklist_items i where i.card_id=c.id and i.deleted_at is null),'[]') as checklist,
      coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'title',b.title) order by b.id)
        from app.card_dependencies d join app.cards b on b.id=d.blocked_by_card_id and b.deleted_at is null and b.status='active'
        where d.card_id=c.id),'[]') as "blockedBy",
      (select count(*)::int from app.card_comments cm where cm.card_id=c.id and cm.deleted_at is null) as "commentCount"
    from app.cards c left join app.users u on u.id=c.assignee_user_id
    left join app.projects p on p.id=c.project_id and p.deleted_at is null
    where c.id=${id} and c.department_id=${departmentId} and c.deleted_at is null`)
  if (!rows[0]) throw new AiInputValidationError('The referenced task is unavailable')
  return rows[0]
}
async function candidates(tx: Tx, departmentId: string) {
  return tx.raw(sql`
    select u.id as "userId",concat_ws(' ',u.given_name,u.family_name) as "fullName",
      (select count(*)::int from app.cards c where c.department_id=${departmentId} and c.assignee_user_id=u.id and c.deleted_at is null and c.status='active') as "openCount",
      (select count(*)::int from app.cards c where c.department_id=${departmentId} and c.assignee_user_id=u.id and c.deleted_at is null and c.status='active' and c.due_at<now()) as "overdueCount",
      coalesce((select (array_agg(distinct l.name order by l.name))[1:20] from app.cards c join app.labels l on l.id=any(c.labels) and l.deleted_at is null
        where c.department_id=${departmentId} and c.assignee_user_id=u.id and c.deleted_at is null and c.updated_at>now()-interval '90 days'),'{}') as "recentLabels",
      null::boolean as away
    from app.memberships m join app.users u on u.id=m.user_id
    where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null and u.status='active'
    order by u.id limit 200`)
}

/** Each helper reads only its own live record or compact closed directory. No department dump. */
export async function prepareLiveContext(
  ctx: RequestContext,
  departmentId: string,
  feature: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (feature === 'subtask_breakdown' && input['taskId'])
    return withContext(ctx, async (tx) => {
      const taskId = recordId(input['taskId'])
      const tasks = await tx.raw<{ title: string; notes: string | null }>(
        sql`select title,notes from app.personal_tasks where id=${taskId} and user_id=${ctx.userId} and deleted_at is null`,
      )
      if (!tasks[0]) throw new AiInputValidationError('The referenced personal task is unavailable')
      const children = await tx.raw<{ title: string }>(
        sql`select title from app.personal_tasks where parent_id=${taskId} and user_id=${ctx.userId} and deleted_at is null order by sort,id limit 50`,
      )
      return {
        ...input,
        cardTitle: tasks[0].title,
        cardDescription: tasks[0].notes?.slice(0, 4000) ?? null,
        existingSubtasks: children.map((c) => c.title),
        labels: [],
        projectTitle: null,
        dueInDays: null,
      }
    })
  if (feature === 'plan_sprint' && input['scope'] === 'personal' && input['periodId'])
    return withContext(ctx, async (tx) => {
      const periodId = recordId(input['periodId'])
      const periods = await tx.raw<{ kind: string; goal: string | null; endsAt: string }>(
        sql`select kind,goal,ends_at as "endsAt" from app.personal_sprints where id=${periodId} and user_id=${ctx.userId} and deleted_at is null and status='active'`,
      )
      if (!periods[0])
        throw new AiInputValidationError('The referenced working period is unavailable')
      const period = periods[0]
      const items = await tx.raw(
        sql`select id,title,estimate_min as "estimateMin",null::text as "dueAt",'none'::text as priority,null::text as "assigneeName",'{}'::uuid[] as "blockedByIds" from app.personal_tasks where sprint_id=${periodId} and user_id=${ctx.userId} and deleted_at is null and done_at is null and parent_id is null order by sort,id limit 100`,
      )
      return {
        ...input,
        periodKind: period.kind,
        goal: period.goal,
        now: new Date().toISOString(),
        periodEndsAt: iso(period.endsAt),
        capacityMin:
          period.kind === '3h'
            ? Math.max(0, Math.round((new Date(period.endsAt).getTime() - Date.now()) / 60_000))
            : null,
        items,
      }
    })
  if (feature === 'translate' && typeof input['text'] === 'string')
    return withContext(ctx, async (tx) => {
      const text = input['text'] as string
      const names = await tx.raw<{ full: string; given: string }>(
        sql`select concat_ws(' ',u.given_name,u.family_name) as full,u.given_name as given from app.memberships m join app.users u on u.id=m.user_id where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null order by u.id limit 200`,
      )
      const literal = [
        ...text.matchAll(
          /https?:\/\/[^\s<>]+|@[\p{L}\p{N}_-]+|\b(?:[A-Z]{2,}[A-Z\d-]*|\d+(?:[.,:/-]\d+)*)\b/gu,
        ),
      ].map((m) => m[0])
      const preserve = [
        ...new Set([
          ...(Array.isArray(input['preserve'])
            ? input['preserve'].filter((v): v is string => typeof v === 'string')
            : []),
          ...literal,
          ...names.flatMap((n) =>
            [n.full, n.given].filter((name) => name.length >= 3 && text.includes(name)),
          ),
        ]),
      ]
        .filter((v) => v.length <= 200)
        .slice(0, 60)
      const target = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']).safeParse(input['targetLocale'])
      if (!target.success) throw new AiInputValidationError('A translation target is required')
      const glossary = (['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const)
        .filter((locale) => locale !== target.data)
        .flatMap((locale) => glossaryFor(locale, target.data))
      return { ...input, preserve, glossary }
    })
  if (
    feature === 'deadline_risk' ||
    feature === 'suggest_assignee' ||
    (feature === 'subtask_breakdown' && input['cardId'])
  ) {
    const givenCard = input['card'] as { id?: unknown } | undefined
    const id = recordId(feature === 'subtask_breakdown' ? input['cardId'] : givenCard?.id)
    return withContext(ctx, async (tx) => {
      const card = await cardContext(tx, departmentId, id)
      if (feature === 'subtask_breakdown')
        return {
          ...input,
          cardTitle: card.title,
          cardDescription: card.description?.text?.slice(0, 4000) ?? null,
          existingSubtasks: card.checklist.map((i) => i.text).slice(0, 50),
          labels: card.labels.slice(0, 20),
          projectTitle: card.projectTitle,
          dueInDays: card.due_at
            ? Math.floor((new Date(card.due_at).getTime() - Date.now()) / 86_400_000)
            : null,
        }
      if (feature === 'suggest_assignee')
        return {
          ...input,
          card: {
            id: card.id,
            title: card.title,
            labels: card.labels.slice(0, 20),
            projectTitle: card.projectTitle,
            estimateMin: card.estimate_min,
          },
          candidates: await candidates(tx, departmentId),
        }
      const due = card.due_at ? new Date(card.due_at).getTime() : null
      const riskLevel =
        card.status !== 'active' || due === null
          ? 'none'
          : due < Date.now()
            ? 'overdue'
            : due - Date.now() <= 2 * 86_400_000
              ? 'at_risk'
              : 'none'
      return {
        ...input,
        card: {
          id: card.id,
          title: card.title,
          riskLevel,
          dueDate: card.due_at ? tashkentDate(card.due_at) : null,
          today: tashkentToday(),
          checklistTotal: card.checklist.length,
          checklistDone: card.checklist.filter((i) => i.done).length,
          daysSinceUpdate: age(card.updated_at),
          assigneeName: card.assigneeName,
          commentCount: card.commentCount,
          blockedByTitles: card.blockedBy.map((b) => b.title).slice(0, 10),
          similarSlippedCount: null,
        },
      }
    })
  }
  if (feature === 'draft_event' || feature === 'nl_analytics')
    return withContext(ctx, async (tx) => {
      if (feature === 'draft_event') {
        const counts = await tx.raw<{ count: number }>(
          sql`select count(*)::int as count from app.memberships m join app.users u on u.id=m.user_id where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null and u.status='active'`,
        )
        const events = await tx.raw<{ title: string }>(
          sql`select title from app.events where department_id=${departmentId} and deleted_at is null order by starts_at desc,id limit 10`,
        )
        return {
          ...input,
          today: tashkentToday(),
          departmentSize: Math.max(1, counts[0]?.count ?? 0),
          recentEventTitles: events.map((e) => e.title),
        }
      }
      const members = await tx.raw<{ name: string }>(
        sql`select concat_ws(' ',u.given_name,u.family_name) as name from app.memberships m join app.users u on u.id=m.user_id where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null and u.status='active' order by u.id limit 200`,
      )
      const units = await tx.raw<{ name: string }>(
        sql`select name from app.units where department_id=${departmentId} and deleted_at is null order by name,id limit 100`,
      )
      const labels = await tx.raw<{ name: string }>(
        sql`select name from app.labels where department_id=${departmentId} and deleted_at is null order by name,id limit 200`,
      )
      const projects = await tx.raw<{ title: string }>(
        sql`select title from app.projects where department_id=${departmentId} and deleted_at is null order by updated_at desc,id limit 100`,
      )
      // The filter resolver accepts a full name; no login or email needs to leave the server.
      return {
        ...input,
        today: tashkentToday(),
        knownUnits: units.map((x) => x.name),
        knownLabels: labels.map((x) => x.name),
        knownProjects: projects.map((x) => x.title),
        knownMembers: members.slice(0, 200).map((x) => ({ name: x.name, handle: x.name })),
      }
    })
  if (feature === 'board_risk_digest')
    return withContext(ctx, async (tx) => {
      const departments = await tx.raw<{ name: string }>(
        sql`select name from app.departments where id=${departmentId}`,
      )
      const cards =
        await tx.raw(sql`select c.id,c.title,case when c.due_at<now() then 'overdue' else 'at_risk' end as "riskLevel",
      nullif(concat_ws(' ',u.given_name,u.family_name),'') as "assigneeName",to_char(c.due_at at time zone 'Asia/Tashkent','YYYY-MM-DD') as "dueDate",
      greatest(0,floor(extract(epoch from now()-c.due_at)/86400))::int as "daysOverdue",
      greatest(0,floor(extract(epoch from now()-c.updated_at)/86400))::int as "daysSinceUpdate",
      (select count(*)::int from app.card_checklist_items i where i.card_id=c.id and i.deleted_at is null and i.done_at is not null) as "checklistDone",
      (select count(*)::int from app.card_checklist_items i where i.card_id=c.id and i.deleted_at is null) as "checklistTotal",
      exists(select 1 from app.card_dependencies d join app.cards b on b.id=d.blocked_by_card_id and b.deleted_at is null and b.status='active' where d.card_id=c.id) as blocked
      from app.cards c left join app.users u on u.id=c.assignee_user_id where c.department_id=${departmentId} and c.deleted_at is null and c.status='active' and c.due_at<=now()+interval '2 days' order by c.due_at,c.updated_at,c.id limit 40`)
      const people = (await candidates(tx, departmentId)) as {
        fullName: string
        openCount: number
      }[]
      return {
        ...input,
        departmentName: departments[0]?.name ?? input['departmentName'],
        today: tashkentToday(),
        cards,
        loadPerPerson: people
          .map((p) => ({ name: p.fullName, openCount: p.openCount }))
          .slice(0, 100),
      }
    })
  if (feature === 'plan_sprint' && input['scope'] === 'project' && input['projectId'])
    return withContext(ctx, async (tx) => {
      const projectId = recordId(input['projectId'])
      const projects = await tx.raw<{ title: string }>(
        sql`select title from app.projects where id=${projectId} and department_id=${departmentId} and deleted_at is null`,
      )
      if (!projects[0]) throw new AiInputValidationError('The referenced project is unavailable')
      const items =
        await tx.raw(sql`select c.id,c.title,c.estimate_min as "estimateMin",c.due_at as "dueAt",c.priority,
      nullif(concat_ws(' ',u.given_name,u.family_name),'') as "assigneeName",
      coalesce((select array_agg(b.id order by b.id) from app.card_dependencies d join app.cards b on b.id=d.blocked_by_card_id and b.deleted_at is null and b.status='active' where d.card_id=c.id),'{}') as "blockedByIds"
      from app.cards c left join app.users u on u.id=c.assignee_user_id where c.project_id=${projectId} and c.department_id=${departmentId} and c.deleted_at is null and c.status='active' and c.project_scope<>'subjective' order by c.order_key,c.id limit 100`)
      return {
        ...input,
        goal: projects[0].title,
        capacityMin: null,
        now: new Date().toISOString(),
        items,
      }
    })
  if (feature === 'summarize_thread' || feature === 'draft_reply')
    return withContext(ctx, async (tx) => {
      const subject = input['subject'] as { kind?: unknown; id?: unknown } | undefined
      const id = recordId(subject?.id)
      if (subject?.kind !== 'card' && subject?.kind !== 'event')
        throw new AiInputValidationError('A task or event thread is required')
      const subjects =
        subject.kind === 'card'
          ? await tx.raw<{ title: string }>(
              sql`select title from app.cards where id=${id} and department_id=${departmentId} and deleted_at is null`,
            )
          : await tx.raw<{ title: string }>(
              sql`select title from app.events where id=${id} and department_id=${departmentId} and deleted_at is null`,
            )
      if (!subjects[0]) throw new AiInputValidationError('The referenced discussion is unavailable')
      const comments =
        subject.kind === 'card'
          ? await tx.raw<{ id: string; author: string; text: string; createdAt: string }>(
              sql`select cm.id,concat_ws(' ',u.given_name,u.family_name) as author,cm.body->>'text' as text,cm.created_at as "createdAt" from app.card_comments cm join app.users u on u.id=cm.author_user_id where cm.card_id=${id} and cm.department_id=${departmentId} and cm.deleted_at is null order by cm.created_at desc,cm.id desc limit 61`,
            )
          : await tx.raw<{ id: string; author: string; text: string; createdAt: string }>(
              sql`select cm.id,concat_ws(' ',u.given_name,u.family_name) as author,cm.body as text,cm.created_at as "createdAt" from app.event_comments cm join app.users u on u.id=cm.author_user_id where cm.event_id=${id} and cm.department_id=${departmentId} and cm.deleted_at is null order by cm.created_at desc,cm.id desc limit 61`,
            )
      const viewers = await tx.raw<{ name: string }>(
        sql`select concat_ws(' ',given_name,family_name) as name from app.users where id=${ctx.userId}`,
      )
      let length = 0
      const kept = comments
        .slice(0, 60)
        .map((c) => ({ ...c, text: c.text.slice(0, 4000) }))
        .filter((c) => {
          if (length + c.text.length > 32_000) return false
          length += c.text.length
          return true
        })
        .reverse()
      return {
        ...input,
        subject: { kind: subject.kind, id, title: subjects[0].title },
        viewerName: viewers[0]?.name || input['viewerName'],
        viewerRole: ctx.departmentRole === 'head' ? 'head' : 'member',
        comments: kept.map((c) => ({
          ...c,
          text: c.text.slice(0, 4000),
          createdAt: iso(c.createdAt),
        })),
        commentsTruncated: kept.length < comments.length,
      }
    })
  return input
}

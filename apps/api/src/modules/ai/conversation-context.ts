import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AiChatSource } from '@devon/contracts'
import { refreshIndex, searchText } from './search-repo.js'

type SnapshotRow = { ref: string; title: string; href: string; facts: unknown; total: number }
export type DepartmentChatContext = {
  generatedAt: string
  recordsTotal: number
  recordsIncluded: number
  limited: boolean
  snapshot: unknown[]
  evidence: unknown[]
  sources: AiChatSource[]
  totals: unknown
}

/** Compact current records plus relevant full-text evidence. Only department tables are read:
 * private personal workspaces, profile contacts, uploads and other conversations never enter AI. */
export async function conversationContext(
  ctx: RequestContext,
  question: string,
  priorityRefs: string[] = [],
): Promise<DepartmentChatContext> {
  const departmentId = ctx.departmentId!
  const [rows, retrieved, totals] = await Promise.all([
    withContext(ctx, (tx) =>
      tx.raw<SnapshotRow>(sql`
      with records as (
        select 'unit:'||id as ref,name as title,'/structure'::text as href,
          jsonb_build_object('kind','unit','parentId',parent_unit_id,'expectedPeople',expected_people) as facts,1 as rank
        from app.units where department_id=${departmentId} and deleted_at is null
        union all
        select 'person:'||u.id,concat_ws(' ',u.given_name,u.family_name),'/people',
          jsonb_build_object('kind','person','units',coalesce(ur.units,'[]'::jsonb),'role',m.role),2
        from app.memberships m join app.users u on u.id=m.user_id
        left join (select user_id,jsonb_agg(jsonb_build_object('unitId',unit_id,'role',role) order by unit_id) as units
          from app.unit_roles where department_id=${departmentId} and deleted_at is null group by user_id) ur on ur.user_id=m.user_id
        where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null
        union all
        select 'project:'||p.id,p.title,'/projects/view?id='||p.id,
          jsonb_build_object('kind','project','status',p.status,'ownerId',p.owner_user_id,'members',p.members,
            'targetDate',p.target_on,'milestones',p.milestones),3
        from app.projects p where p.department_id=${departmentId} and p.deleted_at is null
        union all
        select 'card:'||c.id,c.title,'/work/card?id='||c.id,
          jsonb_build_object('kind','card','status',c.status,'stage',c.work_stage,'priority',c.priority,
            'assigneeId',c.assignee_user_id,'projectId',c.project_id,'dueAt',c.due_at,
            'updatedAt',c.updated_at,'checklistDone',coalesce(i.done,0),'checklistTotal',coalesce(i.total,0)),
          case when c.status='active' then 4 else 7 end
        from app.cards c left join (
          select card_id,count(*)::int as total,count(*) filter(where done_at is not null)::int as done
          from app.card_checklist_items where department_id=${departmentId} and deleted_at is null group by card_id
        ) i on i.card_id=c.id where c.department_id=${departmentId} and c.deleted_at is null
        union all
        select 'event:'||e.id,e.title,'/events?event='||e.id,
          jsonb_build_object('kind','event','startsAt',e.starts_at,'endsAt',e.ends_at),5
        from app.events e where e.department_id=${departmentId} and e.deleted_at is null
        union all
        select 'page:'||p.id,p.title,'/pages?page='||p.id,
          jsonb_build_object('kind','page','updatedAt',p.updated_at),6
        from app.pages p where p.department_id=${departmentId} and p.deleted_at is null
      ) select *,count(*) over()::int as total from records order by case when ref=any(${sql.param(priorityRefs)}::text[]) then 0 else rank end,ref limit 2000
    `),
    ),
    withContext(ctx, async (tx) => {
      await refreshIndex(tx, departmentId)
      return searchText(tx, departmentId, question, 12)
    }),
    withContext(ctx, (tx) =>
      tx.raw(sql`select
      (select count(*)::int from app.memberships m join app.users u on u.id=m.user_id where m.department_id=${departmentId} and m.status='active' and m.deleted_at is null and u.deleted_at is null) as people,
      (select count(*)::int from app.units where department_id=${departmentId} and deleted_at is null) as units,
      (select sum(expected_people)::int from app.units where department_id=${departmentId} and deleted_at is null) as planned_positions,
      (select jsonb_object_agg(status,n) from (select status,count(*)::int n from app.projects where department_id=${departmentId} and deleted_at is null group by status) p) as projects_by_status,
      (select jsonb_agg(c) from (select status,work_stage,project_id is not null as project_task,count(*)::int as count from app.cards where department_id=${departmentId} and deleted_at is null group by status,work_stage,project_id is not null) c) as cards_by_status,
      (select count(*)::int from app.cards where department_id=${departmentId} and deleted_at is null and status='active' and due_at<now()) as overdue_cards,
      (select count(*)::int from app.events where department_id=${departmentId} and deleted_at is null and starts_at>=now()) as upcoming_events`),
    ),
  ])
  const snapshot: unknown[] = []
  const sources: AiChatSource[] = []
  let bytes = 0
  const categoryBytes = new Map<string, number>()
  const categoryLimits: Record<string, number> = {
    unit: 6000,
    person: 10000,
    project: 18000,
    card: 26000,
    event: 8000,
    page: 4000,
  }
  for (const row of rows) {
    const item = { ref: row.ref, title: row.title, facts: row.facts }
    const length = Buffer.byteLength(JSON.stringify(item), 'utf8')
    const category = row.ref.split(':')[0]!
    if (
      bytes + length > 72_000 ||
      (categoryBytes.get(category) ?? 0) + length > (categoryLimits[category] ?? 4000)
    )
      continue
    bytes += length
    categoryBytes.set(category, (categoryBytes.get(category) ?? 0) + length)
    snapshot.push(item)
    sources.push({ ref: row.ref, title: row.title, href: row.href })
  }
  const evidence = retrieved.map((hit) => {
    const ref = `${hit.subject_type}:${hit.subject_id}`
    const href =
      hit.subject_type === 'project'
        ? `/projects/view?id=${hit.subject_id}`
        : hit.subject_type === 'card'
          ? `/work/card?id=${hit.subject_id}`
          : hit.subject_type === 'page'
            ? `/pages?page=${hit.subject_id}`
            : hit.subject_type === 'event'
              ? `/events?event=${hit.subject_id}`
              : '/work/table'
    if (!sources.some((source) => source.ref === ref)) sources.push({ ref, title: hit.title, href })
    return { ref, title: hit.title, excerpt: hit.snippet.slice(0, 1500) }
  })
  const recordsTotal = rows[0]?.total ?? 0
  sources.push({ ref: `department:${departmentId}`, title: 'Department totals', href: '/' })
  return {
    generatedAt: new Date().toISOString(),
    recordsTotal,
    recordsIncluded: snapshot.length,
    limited: recordsTotal > snapshot.length,
    snapshot,
    evidence,
    sources,
    totals: { ref: `department:${departmentId}`, ...(totals[0] as object) },
  }
}

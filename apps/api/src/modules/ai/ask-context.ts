import { sql } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { SearchHitDto } from './schemas.js'

export type ComparisonScope = 'individual' | 'projects' | 'all'
/** Broad overlap questions need comparisons of live work, not keyword matches for "duplicate". */
export function comparisonScope(question: string): ComparisonScope | null {
  const text = question.toLowerCase()
  const similar =
    /similar|same\s+(task|work|thing)|duplicat|repetitiv|overlap|takror|bir\s+xil|o[ʻ‘’'`]?xshash|ўхшаш|такрор|бир\s+хил|дублир|повтор|одинаков|похож|схож/.test(
      text,
    )
  if (!similar) return null
  const groups =
    /group|team|project|guruh|jamoa|loyiha|гуруҳ|жамоа|лойиҳа|групп|команд|проект/.test(text)
  const individuals =
    /individual|independent|standalone|yakka|alohida|shaxsiy|якка|алоҳида|шахсий|индивидуал|самостоятельн/.test(
      text,
    )
  const excludesGroups =
    /not\s+(group|project|team)|excluding\s+(group|project|team)|без\s+(групп|проект)|guruh.*emas|loyiha.*emas/.test(
      text,
    )
  if (excludesGroups) return 'individual'
  if (individuals && groups) return 'all'
  if (individuals) return 'individual'
  if (groups) return 'projects'
  return /duplicat|repetitiv|overlap|takror|bir\s+xil|такрор|бир\s+хил|дублир|повтор|одинаков|same\s+(work|thing)/.test(
    text,
  )
    ? 'all'
    : 'individual'
}

type WorkUnit = {
  id: string
  kind: 'card' | 'project'
  title: string
  owner: string | null
  ownerName: string
  summary: string
  rank: number
}

/** Each project is ONE work unit; its internal assignments are never rival projects/tasks.
 * Compact bounded snapshots contain no comments, files, contacts or personal-workspace data. */
export async function comparisonContext(
  ctx: RequestContext,
  departmentId: string,
  question: string,
  scope: ComparisonScope,
): Promise<SearchHitDto[]> {
  const rows = await withContext(ctx, (tx) =>
    tx.raw<WorkUnit>(sql`
    with work_units as (
      select c.id,'card'::text as kind,c.title,c.assignee_user_id as owner,
        concat_ws(' ',u.given_name,u.family_name) as "ownerName",
        left(coalesce((select string_agg(t.value #>> '{}',' ') from jsonb_array_elements(jsonb_path_query_array(c.description,'$.**.text')) t(value)),''),450) as summary
      from (select * from app.cards where department_id=${departmentId} and deleted_at is null
        and project_id is null and status='active' order by updated_at desc,id limit 300) c
      left join app.users u on u.id=c.assignee_user_id
      where c.department_id=${departmentId} and c.deleted_at is null and c.project_id is null and c.status='active'
        and ${scope} <> 'projects'
      union all
      select p.id,'project',p.title,p.owner_user_id,concat_ws(' ',u.given_name,u.family_name),
        left(concat_ws(' ',
          (select string_agg(t.value #>> '{}',' ') from jsonb_array_elements(jsonb_path_query_array(p.description,'$.**.text')) t(value)),
          (select string_agg(s.title,'; ') from (select c.title from app.cards c where c.project_id=p.id and c.deleted_at is null and c.status='active' order by c.id limit 5) s)),700)
      from (select * from app.projects where department_id=${departmentId} and deleted_at is null
        and status in ('planning','active','on_hold') order by updated_at desc,id limit 100) p
      join app.users u on u.id=p.owner_user_id
      where p.department_id=${departmentId} and p.deleted_at is null and p.status in ('planning','active','on_hold')
        and ${scope} <> 'individual'
    ), ranked as (
      select w.*,greatest(similarity(w.title,${question}),coalesce((
        select max(similarity(w.title,other.title)) from work_units other
        where other.id<>w.id and (w.kind='project' or other.kind='project' or w.owner is distinct from other.owner)
      ),0))::float8 as rank from work_units w
    ) select * from ranked order by rank desc,kind,id limit 40`),
  )
  return rows.map((row) => ({
    subjectType: row.kind,
    subjectId: row.id,
    title: row.title,
    snippet: JSON.stringify({
      workType: row.kind === 'project' ? 'group project' : 'independent task',
      ownerId: row.owner,
      owner: row.ownerName,
      summary: row.summary,
    }),
    score: Math.max(0, Math.min(1, row.rank)),
    via: 'trigram',
  }))
}

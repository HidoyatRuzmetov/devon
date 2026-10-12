// Shared read-time rollup for Projects and Analytics/Home. Both consumers must use the same
// measured completion, including partial checklists and work completed before it was archived.
import { sql, type SQL } from 'drizzle-orm'
import type { CardFilterStatus } from '@devon/contracts'

export type ProjectProgressRow = {
  objective_total: number
  objective_done: number
  subjective_total: number
  subjective_done: number
  completion: number
}

export const EMPTY_PROJECT_PROGRESS: ProjectProgressRow = {
  objective_total: 0,
  objective_done: 0,
  subjective_total: 0,
  subjective_done: 0,
  completion: 0,
}

export function projectCompletion(
  progress: ProjectProgressRow,
  project: { status: string; milestones: readonly { doneAt: string | null }[] | null },
): number {
  const total = Number(progress.objective_total) + Number(progress.subjective_total)
  const milestones = project.milestones ?? []
  // Once tasks exist, their measured completion takes precedence over milestones that describe
  // the same work. Milestone-only projects and explicitly completed empty projects still progress.
  return total > 0
    ? Number(progress.completion) / total
    : milestones.length > 0
      ? milestones.filter((milestone) => Boolean(milestone.doneAt)).length / milestones.length
      : project.status === 'done'
        ? 1
        : 0
}

/** One query per page, with project IDs already selected under the caller's department context.
 * Analytics can additionally narrow the task status without changing the canonical calculation. */
export async function getProjectProgressBatch(
  tx: { raw<R>(q: SQL): Promise<R[]> },
  projectIds: readonly string[],
  status: CardFilterStatus | null = null,
): Promise<Map<string, ProjectProgressRow>> {
  if (projectIds.length === 0) return new Map()
  const idList = sql.join(
    projectIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const statusFilter = status !== null ? sql`and c.status = ${status}` : sql``
  const rows = await tx.raw<ProjectProgressRow & { project_id: string }>(
    sql`select
          c.project_id,
          count(*) filter (where c.project_scope <> 'subjective') as objective_total,
          count(*) filter (where c.project_scope <> 'subjective' and (c.status = 'done' or c.done_at is not null)) as objective_done,
          count(*) filter (where c.project_scope = 'subjective') as subjective_total,
          count(*) filter (where c.project_scope = 'subjective' and (c.status = 'done' or c.done_at is not null)) as subjective_done,
          sum(case when c.status = 'done' or c.done_at is not null then 1.0
            when coalesce(checklist.total, 0) > 0 then checklist.done::numeric / checklist.total
            else 0 end) as completion
        from app.cards c
        left join (
          select item.card_id, count(*) as total, count(*) filter (where item.done_at is not null) as done
          from app.card_checklist_items item
          join app.cards parent on parent.id = item.card_id
          where parent.project_id in (${idList}) and parent.deleted_at is null and item.deleted_at is null
          group by item.card_id
        ) checklist on checklist.card_id = c.id
        where c.project_id in (${idList}) and c.deleted_at is null
          and (c.status <> 'archived' or c.done_at is not null) ${statusFilter}
        group by c.project_id`,
  )
  return new Map(rows.map((row) => [row.project_id, row]))
}

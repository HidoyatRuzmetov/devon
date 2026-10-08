// Postgres access for the projects module, through `@devon/db`'s `withContext()`/`tx.raw()` directly
// -- same reasoning as `../work/repo.ts`'s header. Progress is computed at read time from
// `app.cards` (objective + subjective task completion), never stored, so it can never drift from the
// cards it summarises (TECH-SPEC §3.2: "Project progress = weighted completion of objective tasks and
// members' subjective tasks").
import { randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import type { ProjectDTO } from './schemas.js'

export class InvalidProjectMembers extends Error {}

// Persist the selected colour once. A new project gets a varied label; edits never recolour it.
const PROJECT_COLOURS = ['#6366f1', '#d97706', '#0891b2', '#9333ea', '#db2777', '#2563eb']
function defaultColour(id: string) {
  return PROJECT_COLOURS[Number.parseInt(id.slice(0, 8), 16) % PROJECT_COLOURS.length]!
}

/** Promote in one transaction so retries cannot leave duplicate or half-created projects. */
export async function createFromCard(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  members: string[],
) {
  return withContext(ctx, async (tx) => {
    const cards = await tx.raw<{
      title: string
      description: ProjectRow['description']
      project_id: string | null
    }>(sql`
      select title, description, project_id from app.cards where id = ${cardId}
        and department_id = ${departmentId} and deleted_at is null for update`)
    const card = cards[0]
    if (!card) return { ok: false as const, reason: 'not_found' as const }
    if (card.project_id) return { ok: false as const, reason: 'conflict' as const }
    const selected = await checkedMembers(tx, departmentId, ctx.userId!, members)
    const id = randomUUID()
    await tx.raw(sql`insert into app.projects (id, department_id, title, description, owner_user_id, members, status, colour)
      values (${id}, ${departmentId}, ${card.title}, ${card.description ? JSON.stringify(card.description) : null}::jsonb,
        ${ctx.userId}, ${sql.param(selected)}::uuid[], 'active', ${defaultColour(id)})`)
    await tx.raw(sql`update app.cards set project_id = ${id}, project_scope = 'objective', kind = 'project_task',
      updated_at = now(), version = version + 1 where id = ${cardId}`)
    tx.audit({
      action: 'projects.created_from_card',
      subjectType: 'project',
      subjectId: id,
      departmentId,
      after: { cardId, members: selected },
    })
    tx.audit({
      action: 'work.card_updated',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      after: { projectId: id, projectScope: 'objective', kind: 'project_task' },
    })
    tx.emit({
      type: 'projects.project.created',
      payload: { projectId: id, actorUserId: ctx.userId },
      departmentId,
    })
    tx.emit({ type: 'work.card.updated', payload: { cardId }, departmentId })
    const rows = await tx.raw<ProjectRow>(sql`select * from app.projects where id = ${id}`)
    return { ok: true as const, project: toProjectDTO(rows[0]!, await getProgress(tx, id)) }
  })
}

async function checkedMembers(tx: Tx, departmentId: string, owner: string, members: string[]) {
  const ids = [...new Set([owner, ...members])]
  const active = await tx.raw<{ user_id: string }>(sql`select user_id from app.memberships
    where department_id = ${departmentId} and status = 'active' and deleted_at is null
      and user_id = any(${sql.param(ids)}::uuid[])`)
  if (ids.some((id) => !active.some((m) => m.user_id === id))) throw new InvalidProjectMembers()
  return ids
}

type ProjectRow = {
  id: string
  title: string
  description: { format: 'markdown'; text: string } | null
  colour: string
  cover_key: string | null
  owner_user_id: string
  members: string[]
  status: ProjectDTO['status']
  start_on: string | null
  target_on: string | null
  milestones: Array<{ id: string; title: string; dueOn: string | null; doneAt: string | null }>
  created_at: Date
  updated_at: Date
  version: number
}

type ProgressRow = {
  objective_total: number
  objective_done: number
  subjective_total: number
  subjective_done: number
  completion: number
}

function toProjectDTO(row: ProjectRow, progress: ProgressRow): ProjectDTO {
  const total = Number(progress.objective_total) + Number(progress.subjective_total)
  const milestones = row.milestones ?? []
  // Milestone-only projects are real work too. Once tasks exist, keep their measured completion
  // authoritative instead of double-counting checkpoints that describe the same work.
  const completion =
    total > 0
      ? Number(progress.completion) / total
      : milestones.length > 0
        ? milestones.filter((milestone) => Boolean(milestone.doneAt)).length / milestones.length
        : row.status === 'done'
          ? 1
          : 0
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    colour: row.colour,
    coverKey: row.cover_key,
    ownerUserId: row.owner_user_id,
    members: row.members ?? [],
    status: row.status,
    startOn: row.start_on,
    targetOn: row.target_on,
    milestones,
    progress: completion,
    objectiveTotal: Number(progress.objective_total),
    objectiveDone: Number(progress.objective_done),
    subjectiveTotal: Number(progress.subjective_total),
    subjectiveDone: Number(progress.subjective_done),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
  }
}

async function getProgress(
  tx: { raw<R>(q: SQL): Promise<R[]> },
  projectId: string,
): Promise<ProgressRow> {
  return (await getProgressBatch(tx, [projectId])).get(projectId) ?? EMPTY_PROGRESS
}

const EMPTY_PROGRESS: ProgressRow = {
  objective_total: 0,
  objective_done: 0,
  subjective_total: 0,
  subjective_done: 0,
  completion: 0,
}

/** H3.1: the batched form of `getProgress` for a whole page of projects -- one `group by project_id`
 * query instead of one query per project (the N+1 `listProjects` used to run). Projects with zero
 * cards simply have no row in the result and fall back to `EMPTY_PROGRESS`. */
async function getProgressBatch(
  tx: { raw<R>(q: SQL): Promise<R[]> },
  projectIds: readonly string[],
): Promise<Map<string, ProgressRow>> {
  if (projectIds.length === 0) return new Map()
  // Parameterised `in (...)` list (H1.7: never string-concatenated SQL), not one query per project.
  const idList = sql.join(
    projectIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const rows = await tx.raw<ProgressRow & { project_id: string }>(
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
          and (c.status <> 'archived' or c.done_at is not null)
        group by c.project_id`,
  )
  return new Map(rows.map((r) => [r.project_id, r]))
}

export async function listProjects(
  ctx: RequestContext,
  departmentId: string,
): Promise<ProjectDTO[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects
          where department_id = ${departmentId} and deleted_at is null
          order by (status = 'active') desc, created_at desc`,
    )
    // H3.1: one batched `group by project_id` query for every project's progress instead of an
    // N+1 `getProgress` per row.
    const progressByProject = await getProgressBatch(
      tx,
      rows.map((r) => r.id),
    )
    return rows.map((row) => toProjectDTO(row, progressByProject.get(row.id) ?? EMPTY_PROGRESS))
  })
}

export async function getProject(
  ctx: RequestContext,
  departmentId: string,
  id: string,
): Promise<ProjectDTO | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where department_id = ${departmentId} and id = ${id} and deleted_at is null`,
    )
    const row = rows[0]
    if (!row) return null
    return toProjectDTO(row, await getProgress(tx, row.id))
  })
}

type CreateProjectInput = {
  departmentId: string
  title: string
  description: string | undefined
  colour: string | undefined
  ownerUserId: string
  members: string[]
  status: ProjectDTO['status'] | undefined
  startOn: string | undefined
  targetOn: string | undefined
  milestones: Array<{ title: string; dueOn: string | null }> | undefined
}

export async function createProject(
  ctx: RequestContext,
  input: CreateProjectInput,
): Promise<ProjectDTO> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    const members = await checkedMembers(tx, input.departmentId, input.ownerUserId, input.members)
    const description = input.description
      ? { format: 'markdown' as const, text: input.description }
      : null
    const milestones = (input.milestones ?? []).map((m) => ({
      id: randomUUID(),
      title: m.title,
      dueOn: m.dueOn,
      doneAt: null,
    }))
    // `sql.param(arr)` binds the whole array as ONE driver parameter (node-postgres serialises a JS
    // array bound this way into a real Postgres array literal) -- interpolating the bare array
    // instead lets drizzle's own `sql` tag apply its "expand into a parenthesized value list" rule
    // (built for `where col in (${arr})`), which for an *insert value* produces a bare `record` --
    // `()::uuid[]` for an empty array (a flat syntax error) or `($1, $2)::uuid[]` for a non-empty
    // one ("cannot cast type record to uuid[]") -- the identical bug confirmed live in
    // `work/repo.ts`'s `createCard` (quick-add crashed every card create with zero labels).
    await tx.raw(
      sql`insert into app.projects (
            id, department_id, title, description, colour, owner_user_id, members, status,
            start_on, target_on, milestones
          ) values (
            ${id}, ${input.departmentId}, ${input.title},
            ${description ? JSON.stringify(description) : null}::jsonb,
            ${input.colour ?? defaultColour(id)}, ${input.ownerUserId}, ${sql.param(members)}::uuid[],
            ${input.status ?? 'planning'}, ${input.startOn ?? null}, ${input.targetOn ?? null},
            ${JSON.stringify(milestones)}::jsonb
          )`,
    )
    tx.audit({
      action: 'projects.project_created',
      subjectType: 'project',
      subjectId: id,
      departmentId: input.departmentId,
      after: { title: input.title },
    })
    tx.emit({
      type: 'projects.project.created',
      payload: { projectId: id, actorUserId: input.ownerUserId },
      departmentId: input.departmentId,
    })
    const rows = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where id = ${id}`,
    )
    return toProjectDTO(rows[0]!, EMPTY_PROGRESS)
  })
}

type PatchProjectInput = {
  title?: string | undefined
  description?: string | null | undefined
  colour?: string | undefined
  ownerUserId?: string | undefined
  members?: string[] | undefined
  status?: ProjectDTO['status'] | undefined
  startOn?: string | null | undefined
  targetOn?: string | null | undefined
}

export type PatchProjectResult =
  | { ok: true; project: ProjectDTO }
  | { ok: false; reason: 'not_found' | 'conflict' }

export async function patchProject(
  ctx: RequestContext,
  departmentId: string,
  id: string,
  patch: PatchProjectInput,
  expectedVersion: number | undefined,
): Promise<PatchProjectResult> {
  return withContext(ctx, async (tx) => {
    const before = await tx.raw<{ version: number; owner_user_id: string; members: string[] }>(
      sql`select version, owner_user_id, members from app.projects where id = ${id} and department_id = ${departmentId} and deleted_at is null for update`,
    )
    if (!before[0]) return { ok: false, reason: 'not_found' }
    if (expectedVersion !== undefined && before[0].version !== expectedVersion) {
      return { ok: false, reason: 'conflict' }
    }

    const sets: SQL[] = [sql`updated_at = now()`, sql`version = version + 1`]
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`)
    if (patch.description !== undefined) {
      const desc = patch.description
        ? { format: 'markdown' as const, text: patch.description }
        : null
      sets.push(sql`description = ${desc ? JSON.stringify(desc) : null}::jsonb`)
    }
    if (patch.colour !== undefined) sets.push(sql`colour = ${patch.colour}`)
    if (patch.ownerUserId !== undefined) sets.push(sql`owner_user_id = ${patch.ownerUserId}`)
    // sql.param(): the bare array here hits the same "cannot cast type record to uuid[]" / empty-
    // array syntax error bug this file's `createProject` header comment explains.
    if (patch.members !== undefined || patch.ownerUserId !== undefined) {
      const members = await checkedMembers(
        tx,
        departmentId,
        patch.ownerUserId ?? before[0].owner_user_id,
        patch.members ?? before[0].members,
      )
      sets.push(sql`members = ${sql.param(members)}::uuid[]`)
    }
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`)
    if (patch.startOn !== undefined) sets.push(sql`start_on = ${patch.startOn}`)
    if (patch.targetOn !== undefined) sets.push(sql`target_on = ${patch.targetOn}`)

    await tx.raw(sql`update app.projects set ${sql.join(sets, sql`, `)} where id = ${id}`)
    tx.audit({
      action: 'projects.project_updated',
      subjectType: 'project',
      subjectId: id,
      departmentId,
      after: patch,
    })
    tx.emit({ type: 'projects.project.updated', payload: { projectId: id }, departmentId })

    const rows = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where id = ${id}`,
    )
    return { ok: true, project: toProjectDTO(rows[0]!, await getProgress(tx, id)) }
  })
}

export async function addMilestone(
  ctx: RequestContext,
  departmentId: string,
  projectId: string,
  input: { title: string; dueOn?: string | null | undefined; done?: boolean | undefined },
): Promise<ProjectDTO | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ milestones: ProjectRow['milestones'] }>(
      sql`select milestones from app.projects where id = ${projectId} and department_id = ${departmentId} and deleted_at is null for update`,
    )
    if (!rows[0]) return null
    const milestones = [
      ...rows[0].milestones,
      {
        id: randomUUID(),
        title: input.title,
        dueOn: input.dueOn ?? null,
        doneAt: input.done ? new Date().toISOString() : null,
      },
    ]
    await tx.raw(
      sql`update app.projects set milestones = ${JSON.stringify(milestones)}::jsonb, updated_at = now(), version = version + 1
          where id = ${projectId}`,
    )
    tx.audit({
      action: 'projects.milestones_updated',
      subjectType: 'project',
      subjectId: projectId,
      departmentId,
      after: { milestones },
    })
    tx.emit({ type: 'projects.project.updated', payload: { projectId }, departmentId })
    const after = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where id = ${projectId}`,
    )
    return toProjectDTO(after[0]!, await getProgress(tx, projectId))
  })
}

export async function patchMilestone(
  ctx: RequestContext,
  departmentId: string,
  projectId: string,
  milestoneId: string,
  patch: {
    title?: string | undefined
    dueOn?: string | null | undefined
    done?: boolean | undefined
  },
): Promise<ProjectDTO | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ milestones: ProjectRow['milestones'] }>(
      sql`select milestones from app.projects where id = ${projectId} and department_id = ${departmentId} and deleted_at is null for update`,
    )
    if (!rows[0]) return null
    const found = rows[0].milestones.find((m) => m.id === milestoneId)
    if (!found) return null
    const milestones = rows[0].milestones.map((m) =>
      m.id === milestoneId
        ? {
            ...m,
            title: patch.title ?? m.title,
            dueOn: patch.dueOn === undefined ? m.dueOn : patch.dueOn,
            doneAt:
              patch.done === undefined ? m.doneAt : patch.done ? new Date().toISOString() : null,
          }
        : m,
    )
    await tx.raw(
      sql`update app.projects set milestones = ${JSON.stringify(milestones)}::jsonb, updated_at = now(), version = version + 1
          where id = ${projectId}`,
    )
    tx.audit({
      action: 'projects.milestones_updated',
      subjectType: 'project',
      subjectId: projectId,
      departmentId,
      after: { milestones },
    })
    tx.emit({ type: 'projects.project.updated', payload: { projectId }, departmentId })
    const after = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where id = ${projectId}`,
    )
    return toProjectDTO(after[0]!, await getProgress(tx, projectId))
  })
}

export async function deleteMilestone(
  ctx: RequestContext,
  departmentId: string,
  projectId: string,
  milestoneId: string,
) {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<ProjectRow>(sql`select * from app.projects where id = ${projectId}
      and department_id = ${departmentId} and deleted_at is null for update`)
    const before = rows[0]
    const removed = before?.milestones.find((m) => m.id === milestoneId)
    if (!before || !removed) return null
    const milestones = before.milestones.filter((m) => m.id !== milestoneId)
    const after =
      await tx.raw<ProjectRow>(sql`update app.projects set milestones = ${JSON.stringify(milestones)}::jsonb,
      updated_at = now(), version = version + 1 where id = ${projectId} returning *`)
    tx.audit({
      action: 'projects.milestone_deleted',
      subjectType: 'project',
      subjectId: projectId,
      departmentId,
      before: removed,
    })
    tx.emit({ type: 'projects.project.updated', payload: { projectId }, departmentId })
    return toProjectDTO(after[0]!, await getProgress(tx, projectId))
  })
}

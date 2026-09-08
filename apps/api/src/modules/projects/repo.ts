// Postgres access for the projects module, through `@devon/db`'s `withContext()`/`tx.raw()` directly
// -- same reasoning as `../work/repo.ts`'s header. Progress is computed at read time from
// `app.cards` (objective + subjective task completion), never stored, so it can never drift from the
// cards it summarises (TECH-SPEC §3.2: "Project progress = weighted completion of objective tasks and
// members' subjective tasks").
import { randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { ProjectDTO } from './schemas.js'

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
}

function toProjectDTO(row: ProjectRow, progress: ProgressRow): ProjectDTO {
  const total = Number(progress.objective_total) + Number(progress.subjective_total)
  const done = Number(progress.objective_done) + Number(progress.subjective_done)
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
    milestones: row.milestones ?? [],
    progress: total === 0 ? 0 : done / total,
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
  const rows = await tx.raw<ProgressRow>(
    sql`select
          count(*) filter (where project_scope = 'objective') as objective_total,
          count(*) filter (where project_scope = 'objective' and status = 'done') as objective_done,
          count(*) filter (where project_scope = 'subjective') as subjective_total,
          count(*) filter (where project_scope = 'subjective' and status = 'done') as subjective_done
        from app.cards
        where project_id = ${projectId} and deleted_at is null`,
  )
  return (
    rows[0] ?? { objective_total: 0, objective_done: 0, subjective_total: 0, subjective_done: 0 }
  )
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
    const out: ProjectDTO[] = []
    for (const row of rows) {
      out.push(toProjectDTO(row, await getProgress(tx, row.id)))
    }
    return out
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
            ${input.colour ?? '#6366f1'}, ${input.ownerUserId}, ${sql.param(input.members)}::uuid[],
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
      payload: { projectId: id },
      departmentId: input.departmentId,
    })
    const rows = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where id = ${id}`,
    )
    return toProjectDTO(rows[0]!, {
      objective_total: 0,
      objective_done: 0,
      subjective_total: 0,
      subjective_done: 0,
    })
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
  { ok: true; project: ProjectDTO } | { ok: false; reason: 'not_found' | 'conflict' }

export async function patchProject(
  ctx: RequestContext,
  departmentId: string,
  id: string,
  patch: PatchProjectInput,
  expectedVersion: number | undefined,
): Promise<PatchProjectResult> {
  return withContext(ctx, async (tx) => {
    const before = await tx.raw<{ version: number }>(
      sql`select version from app.projects where id = ${id} and department_id = ${departmentId} and deleted_at is null`,
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
    if (patch.members !== undefined) sets.push(sql`members = ${sql.param(patch.members)}::uuid[]`)
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
  input: { title: string; dueOn?: string | null | undefined },
): Promise<ProjectDTO | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ milestones: ProjectRow['milestones'] }>(
      sql`select milestones from app.projects where id = ${projectId} and department_id = ${departmentId} and deleted_at is null`,
    )
    if (!rows[0]) return null
    const milestones = [
      ...rows[0].milestones,
      { id: randomUUID(), title: input.title, dueOn: input.dueOn ?? null, doneAt: null },
    ]
    await tx.raw(
      sql`update app.projects set milestones = ${JSON.stringify(milestones)}::jsonb, updated_at = now(), version = version + 1
          where id = ${projectId}`,
    )
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
      sql`select milestones from app.projects where id = ${projectId} and department_id = ${departmentId} and deleted_at is null`,
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
    const after = await tx.raw<ProjectRow>(
      sql`select id, title, description, colour, cover_key, owner_user_id, members, status,
                 start_on, target_on, milestones, created_at, updated_at, version
          from app.projects where id = ${projectId}`,
    )
    return toProjectDTO(after[0]!, await getProgress(tx, projectId))
  })
}

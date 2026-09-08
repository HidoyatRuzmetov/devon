// The Postgres-backed data layer for the personal workspace (MODULE-GUIDE.md "API modules": "never a
// direct `@devon/db` import from a route handler" -- `index.ts` never imports `@devon/db` itself, only
// this file). Every function opens its own `withContext()` transaction, same convention as
// `apps/api/src/db/repo.ts`.
//
// Raw SQL (`Tx.raw()`), not `Tx.drizzle.select().from(schema.personalTasks)`: `@devon/db`'s public
// barrel (`packages/db/src/index.ts`) re-exports `schema/index.ts`, which never carries a module's own
// table file (MODULE-GUIDE.md "DB: schema" -- "you do not add an `export *` line to `schema/index.ts`"),
// and the package's own handoff contract forbids importing any other `@devon/db` path directly. This
// mirrors `apps/api/src/db/repo.ts`'s `countUsers`, which already uses `tx.raw()` for exactly this
// reason against a table that *is* in the shared map.
//
// I-1 (owner-only, no exception ever): every statement below filters `user_id = $actorUserId` in
// application code, and `migrations/0500_personal.sql`'s RLS policies enforce the same thing again at
// the database layer with no super_admin/view-as carve-out -- belt and suspenders, the same posture
// `audit.ts`'s immutability triggers-plus-grants already takes.
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
import type { AuditCtx } from '../../types.js'

function toRequestContext(ctx: AuditCtx): RequestContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId: null, // personal workspace rows never carry a department (I-1).
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

function joinSet(parts: SQL[]): SQL {
  return sql.join(parts, sql.raw(', '))
}

export type MutationOutcome<T> = { ok: 'done'; row: T } | { ok: 'not_found' } | { ok: 'conflict' }

// ---------------------------------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------------------------------

export type SprintRow = {
  id: string
  kind: '3h' | 'day' | 'week' | 'custom'
  starts_at: Date
  ends_at: Date
  goal: string | null
  status: 'active' | 'completed' | 'archived'
  created_at: Date
  updated_at: Date
  version: number
}

export async function listSprints(userId: string, ctx: AuditCtx): Promise<SprintRow[]> {
  return withContext(toRequestContext(ctx), (tx) =>
    tx.raw<SprintRow>(sql`
      select id, kind, starts_at, ends_at, goal, status, created_at, updated_at, version
      from app.personal_sprints
      where user_id = ${userId} and deleted_at is null
      order by starts_at desc
    `),
  )
}

export async function createSprint(
  userId: string,
  input: { kind: string; startsAt: string; endsAt: string; goal?: string | null | undefined },
  ctx: AuditCtx,
): Promise<SprintRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<SprintRow>(sql`
      insert into app.personal_sprints (user_id, kind, starts_at, ends_at, goal)
      values (${userId}, ${input.kind}, ${new Date(input.startsAt)}, ${new Date(input.endsAt)}, ${input.goal ?? null})
      returning id, kind, starts_at, ends_at, goal, status, created_at, updated_at, version
    `)
    const row = rows[0]!
    tx.audit({
      action: 'personal.sprint.created',
      subjectType: 'personal_sprint',
      subjectId: row.id,
      after: row,
    })
    return row
  })
}

export async function patchSprint(
  userId: string,
  id: string,
  input: {
    goal?: string | null | undefined
    status?: string | undefined
    startsAt?: string | undefined
    endsAt?: string | undefined
    version: number
  },
  ctx: AuditCtx,
): Promise<MutationOutcome<SprintRow>> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const setParts: SQL[] = []
    if (input.goal !== undefined) setParts.push(sql`goal = ${input.goal}`)
    if (input.status !== undefined) setParts.push(sql`status = ${input.status}`)
    if (input.startsAt !== undefined) setParts.push(sql`starts_at = ${new Date(input.startsAt)}`)
    if (input.endsAt !== undefined) setParts.push(sql`ends_at = ${new Date(input.endsAt)}`)
    setParts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<SprintRow>(sql`
      update app.personal_sprints set ${joinSet(setParts)}
      where id = ${id} and user_id = ${userId} and version = ${input.version} and deleted_at is null
      returning id, kind, starts_at, ends_at, goal, status, created_at, updated_at, version
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.personal_sprints where id = ${id} and user_id = ${userId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    tx.audit({
      action: 'personal.sprint.updated',
      subjectType: 'personal_sprint',
      subjectId: row.id,
      after: row,
    })
    return { ok: 'done', row }
  })
}

export type RolloverResult =
  { ok: 'done'; sprint: SprintRow; movedTaskCount: number } | { ok: 'not_found' }

export async function rolloverSprint(
  userId: string,
  sourceSprintId: string,
  input: { startsAt: string; endsAt: string; goal?: string | null | undefined },
  ctx: AuditCtx,
): Promise<RolloverResult> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const source = await tx.raw<SprintRow>(sql`
      select id, kind, starts_at, ends_at, goal, status, created_at, updated_at, version
      from app.personal_sprints where id = ${sourceSprintId} and user_id = ${userId} and deleted_at is null
    `)
    const sourceRow = source[0]
    if (!sourceRow) return { ok: 'not_found' }

    const created = await tx.raw<SprintRow>(sql`
      insert into app.personal_sprints (user_id, kind, starts_at, ends_at, goal)
      values (${userId}, ${sourceRow.kind}, ${new Date(input.startsAt)}, ${new Date(input.endsAt)}, ${input.goal ?? sourceRow.goal})
      returning id, kind, starts_at, ends_at, goal, status, created_at, updated_at, version
    `)
    const newSprint = created[0]!

    // One statement moves every unfinished task at once (I-16: no query in a loop).
    const moved = await tx.raw<{ id: string }>(sql`
      update app.personal_tasks
      set sprint_id = ${newSprint.id}, updated_at = now(), version = version + 1
      where sprint_id = ${sourceSprintId} and user_id = ${userId} and done_at is null and deleted_at is null
      returning id
    `)

    await tx.raw(sql`
      update app.personal_sprints set status = 'completed', updated_at = now(), version = version + 1
      where id = ${sourceSprintId} and user_id = ${userId}
    `)

    tx.audit({
      action: 'personal.sprint.rolled_over',
      subjectType: 'personal_sprint',
      subjectId: sourceSprintId,
      after: { newSprintId: newSprint.id, movedTaskCount: moved.length },
    })
    return { ok: 'done', sprint: newSprint, movedTaskCount: moved.length }
  })
}

// ---------------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------------

export type TaskRow = {
  id: string
  sprint_id: string | null
  parent_id: string | null
  title: string
  done_at: Date | null
  notes: string | null
  sort: number
  estimate_min: number | null
  linked_card_id: string | null
  created_at: Date
  updated_at: Date
  version: number
}

const TASK_COLUMNS = sql.raw(
  'id, sprint_id, parent_id, title, done_at, notes, sort, estimate_min, linked_card_id, created_at, updated_at, version',
)

export async function listTasks(userId: string, ctx: AuditCtx): Promise<TaskRow[]> {
  return withContext(toRequestContext(ctx), (tx) =>
    tx.raw<TaskRow>(sql`
      select ${TASK_COLUMNS} from app.personal_tasks
      where user_id = ${userId} and deleted_at is null
      order by sort asc, created_at asc
    `),
  )
}

export async function createTask(
  userId: string,
  input: {
    title: string
    sprintId?: string | null | undefined
    parentId?: string | null | undefined
    notes?: string | null | undefined
    estimateMin?: number | null | undefined
    linkedCardId?: string | null | undefined
    sort?: number | undefined
  },
  ctx: AuditCtx,
): Promise<TaskRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    let sort = input.sort
    if (sort === undefined) {
      const max = await tx.raw<{ max_sort: number | null }>(sql`
        select max(sort) as max_sort from app.personal_tasks
        where user_id = ${userId} and deleted_at is null
        and sprint_id ${input.sprintId ? sql`= ${input.sprintId}` : sql`is null`}
        and parent_id ${input.parentId ? sql`= ${input.parentId}` : sql`is null`}
      `)
      sort = (max[0]?.max_sort ?? -1) + 1
    }
    const rows = await tx.raw<TaskRow>(sql`
      insert into app.personal_tasks
        (user_id, sprint_id, parent_id, title, notes, estimate_min, linked_card_id, sort)
      values (
        ${userId}, ${input.sprintId ?? null}, ${input.parentId ?? null}, ${input.title},
        ${input.notes ?? null}, ${input.estimateMin ?? null}, ${input.linkedCardId ?? null}, ${sort}
      )
      returning ${TASK_COLUMNS}
    `)
    const row = rows[0]!
    tx.audit({
      action: 'personal.task.created',
      subjectType: 'personal_task',
      subjectId: row.id,
      after: row,
    })
    return row
  })
}

export async function patchTask(
  userId: string,
  id: string,
  input: {
    title?: string | undefined
    sprintId?: string | null | undefined
    parentId?: string | null | undefined
    done?: boolean | undefined
    notes?: string | null | undefined
    estimateMin?: number | null | undefined
    linkedCardId?: string | null | undefined
    sort?: number | undefined
    version: number
  },
  ctx: AuditCtx,
): Promise<MutationOutcome<TaskRow>> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const setParts: SQL[] = []
    if (input.title !== undefined) setParts.push(sql`title = ${input.title}`)
    if (input.sprintId !== undefined) setParts.push(sql`sprint_id = ${input.sprintId}`)
    if (input.parentId !== undefined) setParts.push(sql`parent_id = ${input.parentId}`)
    if (input.notes !== undefined) setParts.push(sql`notes = ${input.notes}`)
    if (input.estimateMin !== undefined) setParts.push(sql`estimate_min = ${input.estimateMin}`)
    if (input.linkedCardId !== undefined) setParts.push(sql`linked_card_id = ${input.linkedCardId}`)
    if (input.sort !== undefined) setParts.push(sql`sort = ${input.sort}`)
    if (input.done !== undefined) setParts.push(sql`done_at = ${input.done ? new Date() : null}`)
    setParts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<TaskRow>(sql`
      update app.personal_tasks set ${joinSet(setParts)}
      where id = ${id} and user_id = ${userId} and version = ${input.version} and deleted_at is null
      returning ${TASK_COLUMNS}
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.personal_tasks where id = ${id} and user_id = ${userId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    tx.audit({
      action: 'personal.task.updated',
      subjectType: 'personal_task',
      subjectId: row.id,
      after: row,
    })
    return { ok: 'done', row }
  })
}

export async function deleteTask(userId: string, id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(toRequestContext(ctx), async (tx) => {
    // The children of a deleted task are deleted with it -- one statement, not a loop, using a
    // recursive CTE to reach arbitrarily nested subtasks in a single round trip.
    const deleted = await tx.raw<{ id: string }>(sql`
      with recursive subtree as (
        select id from app.personal_tasks where id = ${id} and user_id = ${userId} and deleted_at is null
        union all
        select t.id from app.personal_tasks t
        join subtree s on t.parent_id = s.id
        where t.user_id = ${userId} and t.deleted_at is null
      )
      update app.personal_tasks set deleted_at = now(), updated_at = now(), version = version + 1
      where id in (select id from subtree)
      returning id
    `)
    if (deleted.length === 0) return false
    tx.audit({
      action: 'personal.task.deleted',
      subjectType: 'personal_task',
      subjectId: id,
      after: { deletedIds: deleted.map((r) => r.id) },
    })
    return true
  })
}

export async function reorderTasks(
  userId: string,
  items: readonly {
    id: string
    sort: number
    parentId?: string | null | undefined
    sprintId?: string | null | undefined
  }[],
  ctx: AuditCtx,
): Promise<number> {
  return withContext(toRequestContext(ctx), async (tx) => {
    // One statement for the whole drag-reorder batch (I-16: no query in a loop), built as a VALUES
    // list joined against the table.
    const valueRows = items.map(
      (item) =>
        sql`(${item.id}::uuid, ${item.sort}::int, ${item.parentId ?? null}::uuid, ${item.sprintId === undefined ? null : item.sprintId}::uuid, ${item.parentId !== undefined}::bool, ${item.sprintId !== undefined}::bool)`,
    )
    const rows = await tx.raw<{ id: string }>(sql`
      update app.personal_tasks as t
      set
        sort = v.sort,
        parent_id = case when v.set_parent then v.parent_id else t.parent_id end,
        sprint_id = case when v.set_sprint then v.sprint_id else t.sprint_id end,
        updated_at = now(),
        version = t.version + 1
      from (values ${sql.join(valueRows, sql.raw(', '))}) as v(id, sort, parent_id, sprint_id, set_parent, set_sprint)
      where t.id = v.id and t.user_id = ${userId} and t.deleted_at is null
      returning t.id
    `)
    if (rows.length > 0) {
      tx.audit({
        action: 'personal.task.reordered',
        subjectType: 'personal_task',
        subjectId: null,
        after: { count: rows.length },
      })
    }
    return rows.length
  })
}

// ---------------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------------

export type NoteRow = {
  id: string
  title: string
  body: { text: string }
  pinned: boolean
  created_at: Date
  updated_at: Date
  version: number
}

export async function listNotes(userId: string, ctx: AuditCtx): Promise<NoteRow[]> {
  return withContext(toRequestContext(ctx), (tx) =>
    tx.raw<NoteRow>(sql`
      select id, title, body, pinned, created_at, updated_at, version
      from app.personal_notes
      where user_id = ${userId} and deleted_at is null
      order by pinned desc, updated_at desc
    `),
  )
}

export async function createNote(
  userId: string,
  input: { title: string; body?: { text: string } | undefined; pinned?: boolean | undefined },
  ctx: AuditCtx,
): Promise<NoteRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<NoteRow>(sql`
      insert into app.personal_notes (user_id, title, body, pinned)
      values (${userId}, ${input.title}, ${JSON.stringify(input.body ?? { text: '' })}::jsonb, ${input.pinned ?? false})
      returning id, title, body, pinned, created_at, updated_at, version
    `)
    const row = rows[0]!
    tx.audit({
      action: 'personal.note.created',
      subjectType: 'personal_note',
      subjectId: row.id,
      after: row,
    })
    return row
  })
}

export async function patchNote(
  userId: string,
  id: string,
  input: {
    title?: string | undefined
    body?: { text: string } | undefined
    pinned?: boolean | undefined
    version: number
  },
  ctx: AuditCtx,
): Promise<MutationOutcome<NoteRow>> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const setParts: SQL[] = []
    if (input.title !== undefined) setParts.push(sql`title = ${input.title}`)
    if (input.body !== undefined) setParts.push(sql`body = ${JSON.stringify(input.body)}::jsonb`)
    if (input.pinned !== undefined) setParts.push(sql`pinned = ${input.pinned}`)
    setParts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<NoteRow>(sql`
      update app.personal_notes set ${joinSet(setParts)}
      where id = ${id} and user_id = ${userId} and version = ${input.version} and deleted_at is null
      returning id, title, body, pinned, created_at, updated_at, version
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.personal_notes where id = ${id} and user_id = ${userId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    tx.audit({
      action: 'personal.note.updated',
      subjectType: 'personal_note',
      subjectId: row.id,
      after: row,
    })
    return { ok: 'done', row }
  })
}

export async function deleteNote(userId: string, id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.personal_notes set deleted_at = now(), updated_at = now(), version = version + 1
      where id = ${id} and user_id = ${userId} and deleted_at is null
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({ action: 'personal.note.deleted', subjectType: 'personal_note', subjectId: id })
    return true
  })
}

// ---------------------------------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------------------------------

export type CanvasSummaryRow = {
  id: string
  title: string
  created_at: Date
  updated_at: Date
  version: number
}
export type CanvasRow = CanvasSummaryRow & { scene: unknown; stickies: unknown }

export async function listCanvases(userId: string, ctx: AuditCtx): Promise<CanvasSummaryRow[]> {
  return withContext(toRequestContext(ctx), (tx) =>
    tx.raw<CanvasSummaryRow>(sql`
      select id, title, created_at, updated_at, version
      from app.personal_canvases
      where user_id = ${userId} and deleted_at is null
      order by updated_at desc
    `),
  )
}

export async function getCanvas(
  userId: string,
  id: string,
  ctx: AuditCtx,
): Promise<CanvasRow | null> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<CanvasRow>(sql`
      select id, title, scene, stickies, created_at, updated_at, version
      from app.personal_canvases
      where id = ${id} and user_id = ${userId} and deleted_at is null
    `)
    return rows[0] ?? null
  })
}

export async function createCanvas(
  userId: string,
  input: { title: string; scene?: unknown; stickies?: unknown },
  ctx: AuditCtx,
): Promise<CanvasRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<CanvasRow>(sql`
      insert into app.personal_canvases (user_id, title, scene, stickies)
      values (
        ${userId}, ${input.title},
        ${JSON.stringify(input.scene ?? { elements: [], appState: {} })}::jsonb,
        ${JSON.stringify(input.stickies ?? [])}::jsonb
      )
      returning id, title, scene, stickies, created_at, updated_at, version
    `)
    const row = rows[0]!
    tx.audit({
      action: 'personal.canvas.created',
      subjectType: 'personal_canvas',
      subjectId: row.id,
      after: { id: row.id, title: row.title },
    })
    return row
  })
}

export async function patchCanvas(
  userId: string,
  id: string,
  input: { title?: string | undefined; scene?: unknown; stickies?: unknown; version: number },
  ctx: AuditCtx,
): Promise<MutationOutcome<CanvasRow>> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const setParts: SQL[] = []
    if (input.title !== undefined) setParts.push(sql`title = ${input.title}`)
    if (input.scene !== undefined) setParts.push(sql`scene = ${JSON.stringify(input.scene)}::jsonb`)
    if (input.stickies !== undefined)
      setParts.push(sql`stickies = ${JSON.stringify(input.stickies)}::jsonb`)
    setParts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<CanvasRow>(sql`
      update app.personal_canvases set ${joinSet(setParts)}
      where id = ${id} and user_id = ${userId} and version = ${input.version} and deleted_at is null
      returning id, title, scene, stickies, created_at, updated_at, version
    `)
    const row = rows[0]
    if (!row) {
      const exists = await tx.raw<{ id: string }>(sql`
        select id from app.personal_canvases where id = ${id} and user_id = ${userId} and deleted_at is null
      `)
      return exists[0] ? { ok: 'conflict' } : { ok: 'not_found' }
    }
    tx.audit({
      action: 'personal.canvas.updated',
      subjectType: 'personal_canvas',
      subjectId: row.id,
      after: { id: row.id, title: row.title },
    })
    return { ok: 'done', row }
  })
}

export async function deleteCanvas(userId: string, id: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<{ id: string }>(sql`
      update app.personal_canvases set deleted_at = now(), updated_at = now(), version = version + 1
      where id = ${id} and user_id = ${userId} and deleted_at is null
      returning id
    `)
    if (rows.length === 0) return false
    tx.audit({ action: 'personal.canvas.deleted', subjectType: 'personal_canvas', subjectId: id })
    return true
  })
}

// ---------------------------------------------------------------------------------------------------
// Pomodoro
// ---------------------------------------------------------------------------------------------------

export type PomodoroSettingsRow = {
  focus_min: number
  short_break_min: number
  long_break_min: number
  cycles_before_long: number
  sound: string
  notifications: boolean
  auto_start: boolean
}

export async function getPomodoroSettings(
  userId: string,
  ctx: AuditCtx,
): Promise<PomodoroSettingsRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const existing = await tx.raw<PomodoroSettingsRow>(sql`
      select focus_min, short_break_min, long_break_min, cycles_before_long, sound, notifications, auto_start
      from app.pomodoro_settings where user_id = ${userId}
    `)
    if (existing[0]) return existing[0]

    const inserted = await tx.raw<PomodoroSettingsRow>(sql`
      insert into app.pomodoro_settings (user_id) values (${userId})
      on conflict (user_id) do nothing
      returning focus_min, short_break_min, long_break_min, cycles_before_long, sound, notifications, auto_start
    `)
    if (inserted[0]) return inserted[0]

    // Lost the insert race to a concurrent request: the row exists now, read it back.
    const retry = await tx.raw<PomodoroSettingsRow>(sql`
      select focus_min, short_break_min, long_break_min, cycles_before_long, sound, notifications, auto_start
      from app.pomodoro_settings where user_id = ${userId}
    `)
    return retry[0]!
  })
}

export async function patchPomodoroSettings(
  userId: string,
  input: {
    focusMin?: number | undefined
    shortBreakMin?: number | undefined
    longBreakMin?: number | undefined
    cyclesBeforeLong?: number | undefined
    sound?: string | undefined
    notifications?: boolean | undefined
    autoStart?: boolean | undefined
  },
  ctx: AuditCtx,
): Promise<PomodoroSettingsRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    // Ensure the row exists first (same defaulting as a GET) so the UPDATE below always has a target.
    await tx.raw(
      sql`insert into app.pomodoro_settings (user_id) values (${userId}) on conflict (user_id) do nothing`,
    )

    const setParts: SQL[] = []
    if (input.focusMin !== undefined) setParts.push(sql`focus_min = ${input.focusMin}`)
    if (input.shortBreakMin !== undefined)
      setParts.push(sql`short_break_min = ${input.shortBreakMin}`)
    if (input.longBreakMin !== undefined) setParts.push(sql`long_break_min = ${input.longBreakMin}`)
    if (input.cyclesBeforeLong !== undefined)
      setParts.push(sql`cycles_before_long = ${input.cyclesBeforeLong}`)
    if (input.sound !== undefined) setParts.push(sql`sound = ${input.sound}`)
    if (input.notifications !== undefined)
      setParts.push(sql`notifications = ${input.notifications}`)
    if (input.autoStart !== undefined) setParts.push(sql`auto_start = ${input.autoStart}`)
    setParts.push(sql`updated_at = now()`)

    const rows = await tx.raw<PomodoroSettingsRow>(sql`
      update app.pomodoro_settings set ${joinSet(setParts)}
      where user_id = ${userId}
      returning focus_min, short_break_min, long_break_min, cycles_before_long, sound, notifications, auto_start
    `)
    const row = rows[0]!
    tx.audit({
      action: 'personal.pomodoro_settings.updated',
      subjectType: 'pomodoro_settings',
      subjectId: userId,
      after: row,
    })
    return row
  })
}

export type PomodoroSessionRow = {
  id: string
  task_id: string | null
  kind: 'focus' | 'short_break' | 'long_break'
  started_at: Date
  ended_at: Date | null
  completed: boolean
  created_at: Date
}

export async function listPomodoroSessions(
  userId: string,
  ctx: AuditCtx,
  opts: { limit?: number | undefined } = {},
): Promise<PomodoroSessionRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  return withContext(toRequestContext(ctx), (tx) =>
    tx.raw<PomodoroSessionRow>(sql`
      select id, task_id, kind, started_at, ended_at, completed, created_at
      from app.pomodoro_sessions
      where user_id = ${userId}
      order by started_at desc
      limit ${limit}
    `),
  )
}

export async function createPomodoroSession(
  userId: string,
  input: {
    taskId?: string | null | undefined
    kind: string
    startedAt: string
    endedAt?: string | null | undefined
    completed?: boolean | undefined
  },
  ctx: AuditCtx,
): Promise<PomodoroSessionRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<PomodoroSessionRow>(sql`
      insert into app.pomodoro_sessions (user_id, task_id, kind, started_at, ended_at, completed)
      values (
        ${userId}, ${input.taskId ?? null}, ${input.kind}, ${new Date(input.startedAt)},
        ${input.endedAt ? new Date(input.endedAt) : null}, ${input.completed ?? false}
      )
      returning id, task_id, kind, started_at, ended_at, completed, created_at
    `)
    const row = rows[0]!
    tx.audit({
      action: 'personal.pomodoro_session.started',
      subjectType: 'pomodoro_session',
      subjectId: row.id,
      after: row,
    })
    return row
  })
}

export async function patchPomodoroSession(
  userId: string,
  id: string,
  input: { endedAt?: string | null | undefined; completed?: boolean | undefined },
  ctx: AuditCtx,
): Promise<PomodoroSessionRow | null> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const setParts: SQL[] = []
    if (input.endedAt !== undefined)
      setParts.push(sql`ended_at = ${input.endedAt ? new Date(input.endedAt) : null}`)
    if (input.completed !== undefined) setParts.push(sql`completed = ${input.completed}`)
    if (setParts.length === 0) setParts.push(sql`ended_at = ended_at`)

    const rows = await tx.raw<PomodoroSessionRow>(sql`
      update app.pomodoro_sessions set ${joinSet(setParts)}
      where id = ${id} and user_id = ${userId}
      returning id, task_id, kind, started_at, ended_at, completed, created_at
    `)
    const row = rows[0]
    if (!row) return null
    tx.audit({
      action: 'personal.pomodoro_session.ended',
      subjectType: 'pomodoro_session',
      subjectId: row.id,
      after: row,
    })
    return row
  })
}

export type PomodoroStatsRow = {
  today_focus_minutes: number
  today_focus_sessions: number
  today_completed: number
  week_focus_minutes: number
  week_focus_sessions: number
  week_completed: number
}

export async function getPomodoroStats(userId: string, ctx: AuditCtx): Promise<PomodoroStatsRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<PomodoroStatsRow>(sql`
      select
        coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60)
          filter (where kind = 'focus' and started_at >= now() - interval '24 hours'), 0)::float as today_focus_minutes,
        count(*) filter (where kind = 'focus' and started_at >= now() - interval '24 hours')::int as today_focus_sessions,
        count(*) filter (where completed and started_at >= now() - interval '24 hours')::int as today_completed,
        coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60)
          filter (where kind = 'focus' and started_at >= now() - interval '7 days'), 0)::float as week_focus_minutes,
        count(*) filter (where kind = 'focus' and started_at >= now() - interval '7 days')::int as week_focus_sessions,
        count(*) filter (where completed and started_at >= now() - interval '7 days')::int as week_completed
      from app.pomodoro_sessions
      where user_id = ${userId}
    `)
    return (
      rows[0] ?? {
        today_focus_minutes: 0,
        today_focus_sessions: 0,
        today_completed: 0,
        week_focus_minutes: 0,
        week_focus_sessions: 0,
        week_completed: 0,
      }
    )
  })
}

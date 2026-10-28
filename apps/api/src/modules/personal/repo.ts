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
import type { PersonalDeleteReceipt, PersonalTaskVersionChange } from '@devon/contracts'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { sql, type SQL } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { AuditCtx } from '../../types.js'
import { planTaskPlacements, type TaskPlacement } from './task-placement.js'

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

async function lockPersonalTasks(tx: Tx, userId: string) {
  await tx.raw(
    sql`select pg_advisory_xact_lock(hashtextextended(${'personal.tasks:' + userId}, 0))`,
  )
}

export class PersonalTaskAnchorUnavailable extends Error {
  readonly statusCode = 422
  constructor() {
    super('Personal task anchor is unavailable')
    this.name = 'PersonalTaskAnchorUnavailable'
  }
}

export type MutationOutcome<T> = { ok: 'done'; row: T } | { ok: 'not_found' } | { ok: 'conflict' }

// ---------------------------------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------------------------------

export type TaskRow = {
  id: string
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
  'id, parent_id, title, done_at, notes, sort, estimate_min, linked_card_id, created_at, updated_at, version',
)

async function taskGraph(tx: Tx, userId: string): Promise<TaskRow[]> {
  return tx.raw<TaskRow>(sql`select ${TASK_COLUMNS} from app.personal_tasks
    where user_id = ${userId} and deleted_at is null order by id for update`)
}

async function persistPlacements(tx: Tx, userId: string, placements: readonly TaskPlacement[]) {
  if (!placements.length) return []
  const values = placements.map(
    (row) => sql`(${row.id}::uuid, ${row.sort}::int, ${row.parent_id}::uuid)`,
  )
  return tx.raw<{ id: string; version: number }>(sql`update app.personal_tasks t
    set sort = v.sort, parent_id = v.parent_id,
      updated_at = now(), version = t.version + 1
    from (values ${sql.join(values, sql.raw(', '))}) v(id, sort, parent_id)
    where t.id = v.id and t.user_id = ${userId} and t.deleted_at is null returning t.id, t.version`)
}
function taskVersionChanges(
  rows: readonly { id: string; version: number }[],
): PersonalTaskVersionChange[] {
  return rows.map((row) => ({
    id: row.id,
    beforeVersion: row.version - 1,
    afterVersion: row.version,
  }))
}

export async function listTasks(userId: string, ctx: AuditCtx): Promise<TaskRow[]> {
  return withContext(toRequestContext(ctx), (tx) =>
    tx.raw<TaskRow>(sql`
      select ${TASK_COLUMNS} from app.personal_tasks
      where user_id = ${userId} and deleted_at is null
      order by sort asc, created_at asc, id asc
    `),
  )
}

export async function createTask(
  userId: string,
  input: {
    title: string
    parentId?: string | null | undefined
    notes?: string | null | undefined
    estimateMin?: number | null | undefined
    linkedCardId?: string | null | undefined
    sort?: number | undefined
    afterTaskId?: string | undefined
  },
  ctx: AuditCtx,
): Promise<TaskRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    await lockPersonalTasks(tx, userId)
    let parentId = input.parentId ?? null
    let sort = input.sort
    if (input.afterTaskId !== undefined) {
      if (input.parentId !== undefined || input.sort !== undefined)
        throw new PersonalTaskAnchorUnavailable()
      const anchors = await tx.raw<TaskRow>(sql`
        select ${TASK_COLUMNS} from app.personal_tasks
        where id = ${input.afterTaskId} and user_id = ${userId} and deleted_at is null for update
      `)
      const anchor = anchors[0]
      if (!anchor) throw new PersonalTaskAnchorUnavailable()
      parentId = anchor.parent_id
      if (parentId) {
        const parents = await tx.raw<{ id: string }>(sql`select id from app.personal_tasks
          where id = ${parentId} and user_id = ${userId} and deleted_at is null for share`)
        if (!parents[0]) throw new PersonalTaskAnchorUnavailable()
      }
      // Integer positions can tie: normalize only this group in stable visible order and make
      // exactly one slot after the anchor, instead of guessing sort+1 between tied rows.
      const positioned = await tx.raw<{ insert_sort: number; shifted_ids: string[] }>(sql`
        with ordered as (
          select id, (row_number() over(order by sort, created_at, id) - 1)::int as position
          from app.personal_tasks where user_id = ${userId} and deleted_at is null
            and parent_id is not distinct from ${parentId}::uuid
        ), anchor as (
          select position from ordered where id = ${input.afterTaskId}
        ), shifted as (
          update app.personal_tasks t
          set sort = o.position + case when o.position > a.position then 1 else 0 end,
            updated_at = now(), version = t.version + 1
          from ordered o cross join anchor a
          where t.id = o.id and t.user_id = ${userId}
            and t.sort <> o.position + case when o.position > a.position then 1 else 0 end
          returning t.id
        )
        select a.position + 1 as insert_sort,
          (select coalesce(array_agg(id order by id), array[]::uuid[]) from shifted) as shifted_ids
        from anchor a
      `)
      sort = positioned[0]!.insert_sort
      if (positioned[0]!.shifted_ids.length > 0)
        tx.audit({
          action: 'personal.task.reordered',
          subjectType: 'personal_task',
          subjectId: null,
          after: { count: positioned[0]!.shifted_ids.length, reason: 'insert_after' },
        })
    } else if (parentId !== null) {
      const graph = await taskGraph(tx, userId)
      const insertion = { id: randomUUID(), parent_id: null, sort: 0 }
      const placements = planTaskPlacements([...graph, insertion], [{ id: insertion.id, parentId }])
      parentId = placements.find((row) => row.id === insertion.id)!.parent_id
    }
    if (sort === undefined) {
      const max = await tx.raw<{ max_sort: number | null }>(sql`
        select max(sort) as max_sort from app.personal_tasks
        where user_id = ${userId} and deleted_at is null
        and parent_id ${parentId ? sql`= ${parentId}` : sql`is null`}
      `)
      sort = (max[0]?.max_sort ?? -1) + 1
    }
    const rows = await tx.raw<TaskRow>(sql`
      insert into app.personal_tasks
        (user_id, parent_id, title, notes, estimate_min, linked_card_id, sort)
      values (
        ${userId}, ${parentId}, ${input.title},
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
    parentId?: string | null | undefined
    done?: boolean | undefined
    notes?: string | null | undefined
    estimateMin?: number | null | undefined
    linkedCardId?: string | null | undefined
    sort?: number | undefined
    version: number
  },
  ctx: AuditCtx,
): Promise<
  | { ok: 'done'; row: TaskRow; affectedVersions: PersonalTaskVersionChange[] }
  | { ok: 'not_found' }
  | { ok: 'conflict' }
> {
  return withContext(toRequestContext(ctx), async (tx) => {
    await lockPersonalTasks(tx, userId)
    const graph = await taskGraph(tx, userId)
    const previous = graph.find((row) => row.id === id)
    if (!previous) return { ok: 'not_found' }
    if (previous.version !== input.version) return { ok: 'conflict' }
    const requested = { id, parentId: input.parentId, sort: input.sort }
    const placements = planTaskPlacements(graph, [requested])
    const placement = placements.find((row) => row.id === id)!
    const descendants = placements.filter((row) => row.id !== id)
    const changedDescendants = await persistPlacements(tx, userId, descendants)
    const setParts: SQL[] = []
    if (input.title !== undefined) setParts.push(sql`title = ${input.title}`)
    if (placement.parent_id !== previous.parent_id)
      setParts.push(sql`parent_id = ${placement.parent_id}`)
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
    if (descendants.length)
      tx.audit({
        action: 'personal.task.reordered',
        subjectType: 'personal_task',
        subjectId: id,
        after: { count: descendants.length, reason: 'branch_move' },
      })
    return { ok: 'done', row, affectedVersions: taskVersionChanges([row, ...changedDescendants]) }
  })
}

export async function deleteTask(
  userId: string,
  id: string,
  ctx: AuditCtx,
): Promise<PersonalDeleteReceipt | null> {
  return withContext(toRequestContext(ctx), async (tx) => {
    // Parent and child Undo/delete operations share one owner namespace, avoiding inverted
    // parent/child row-lock order while preserving strict personal RLS.
    await lockPersonalTasks(tx, userId)
    const root = await tx.raw<{ id: string }>(sql`
      select id from app.personal_tasks
      where id = ${id} and user_id = ${userId} and deleted_at is null for update
    `)
    if (!root[0]) return null
    const restoreToken = randomUUID()
    // The children of a deleted task are deleted with it -- one statement, not a loop, using a
    // recursive CTE to reach arbitrarily nested subtasks in a single round trip.
    const deleted = await tx.raw<{ id: string }>(sql`
      with recursive subtree as (
        select id from app.personal_tasks where id = ${id} and user_id = ${userId} and deleted_at is null
        union
        select t.id from app.personal_tasks t
        join subtree s on t.parent_id = s.id
        where t.user_id = ${userId} and t.deleted_at is null
      )
      update app.personal_tasks
      set deleted_at = now(), deleted_operation_id = ${restoreToken}, updated_at = now(), version = version + 1
      where user_id = ${userId} and deleted_at is null and id in (select id from subtree)
      returning id
    `)
    if (deleted.length === 0) return null
    tx.audit({
      action: 'personal.task.deleted',
      subjectType: 'personal_task',
      subjectId: id,
      after: { deletedIds: deleted.map((r) => r.id) },
    })
    return { restoreToken }
  })
}

export async function restoreTask(
  userId: string,
  id: string,
  restoreToken: string,
  ctx: AuditCtx,
): Promise<MutationOutcome<TaskRow>> {
  return withContext(toRequestContext(ctx), async (tx) => {
    await lockPersonalTasks(tx, userId)
    const roots = await tx.raw<TaskRow>(sql`
      select ${TASK_COLUMNS} from app.personal_tasks
      where id = ${id} and user_id = ${userId} and deleted_at is not null
        and deleted_operation_id = ${restoreToken} for update
    `)
    const root = roots[0]
    if (!root) return { ok: 'not_found' }
    if (root.parent_id) {
      const parent = await tx.raw<{ id: string }>(sql`
        select id from app.personal_tasks
        where id = ${root.parent_id} and user_id = ${userId} and deleted_at is null for share
      `)
      if (!parent[0]) return { ok: 'conflict' }
    }
    const restored = await tx.raw<TaskRow>(sql`
      with recursive subtree as (
        select id from app.personal_tasks
        where id = ${id} and user_id = ${userId} and deleted_at is not null
          and deleted_operation_id = ${restoreToken}
        union
        select t.id from app.personal_tasks t join subtree s on t.parent_id = s.id
        where t.user_id = ${userId} and t.deleted_at is not null
          and t.deleted_operation_id = ${restoreToken}
      )
      update app.personal_tasks
      set deleted_at = null, deleted_operation_id = null, updated_at = now(), version = version + 1
      where user_id = ${userId} and deleted_at is not null
        and deleted_operation_id = ${restoreToken} and id in (select id from subtree)
      returning ${TASK_COLUMNS}
    `)
    const row = restored.find((item) => item.id === id)!
    tx.audit({
      action: 'personal.task.restored',
      subjectType: 'personal_task',
      subjectId: id,
      after: { restoredIds: restored.map((item) => item.id) },
    })
    return { ok: 'done', row }
  })
}

export async function reorderTasks(
  userId: string,
  items: readonly {
    id: string
    sort: number
    parentId?: string | null | undefined
  }[],
  ctx: AuditCtx,
): Promise<{ updated: number; affectedVersions: PersonalTaskVersionChange[] }> {
  return withContext(toRequestContext(ctx), async (tx) => {
    await lockPersonalTasks(tx, userId)
    const graph = await taskGraph(tx, userId)
    const placements = planTaskPlacements(graph, items)
    const rows = await persistPlacements(tx, userId, placements)
    if (rows.length > 0) {
      tx.audit({
        action: 'personal.task.reordered',
        subjectType: 'personal_task',
        subjectId: null,
        after: { count: rows.length },
      })
    }
    return { updated: rows.length, affectedVersions: taskVersionChanges(rows) }
  })
}

// ---------------------------------------------------------------------------------------------------
// Notes
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
      select id, kind, started_at, ended_at, completed, created_at
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
    kind: string
    startedAt: string
    endedAt?: string | null | undefined
    completed?: boolean | undefined
  },
  ctx: AuditCtx,
): Promise<PomodoroSessionRow> {
  return withContext(toRequestContext(ctx), async (tx) => {
    const rows = await tx.raw<PomodoroSessionRow>(sql`
      insert into app.pomodoro_sessions (user_id, kind, started_at, ended_at, completed)
      values (
        ${userId}, ${input.kind}, ${new Date(input.startedAt)},
        ${input.endedAt ? new Date(input.endedAt) : null}, ${input.completed ?? false}
      )
      returning id, kind, started_at, ended_at, completed, created_at
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
      returning id, kind, started_at, ended_at, completed, created_at
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

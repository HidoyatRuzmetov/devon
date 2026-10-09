// Postgres access for the v1.1 work-plus surfaces (SPEC §7): dependencies, the light time log,
// reminders, templates, the focus list, per-person capacity, the workload grid, goals and the bulk
// bar. Same rules as `repo.ts` -- `withContext()`/`tx.raw()` directly, one transaction per function,
// never a query inside a loop.
//
// Split from `repo.ts` for the same reason `schemas-plus.ts` is split from `schemas.ts`: the v1.0
// card repo is referenced by name across the codebase, and appending 700 lines to it would make
// both halves harder to review than either is alone.
import { randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import {
  DEFAULT_WEEKLY_CAPACITY_HOURS,
  goalProgress,
  matchesFilterQuery,
  parseFilterQuery,
  wouldCreateDependencyCycle,
  cardTemplatePayloadSchema,
  type CardTemplatePayload,
  type FilterableCard,
  type GoalMetric,
  type WorkTemplateKind,
  type WorkTemplateScope,
} from '@devon/contracts'
import type { CardDTO } from './schemas.js'
import type { CardRef } from './schemas-plus.js'
import { createCardInTx, lockActiveCardTargets, lockActiveCardLabels } from './repo.js'

/** A9: five pinned cards. More than five is a to-do list, not a focus list -- CLICKUP-RESEARCH §9's
 * own finding about "Personal Priorities". */
export const FOCUS_MAX = 5

/** A card that is not yours cannot be pinned by you, and a done card falls off the list on its own;
 * both are handled where they happen rather than by a database constraint that could not explain
 * itself. */
type CardRefRow = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  due_at: Date | null
  assignee_user_id: string | null
}

function toCardRef(row: CardRefRow): CardRef {
  const due = row.due_at ? new Date(row.due_at) : null
  const now = Date.now()
  const risk =
    row.status !== 'active' || due === null
      ? 'none'
      : due.getTime() < now
        ? 'overdue'
        : due.getTime() - now <= 2 * 24 * 60 * 60 * 1000
          ? 'at_risk'
          : 'none'
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    risk,
    dueAt: due ? due.toISOString() : null,
    assigneeUserId: row.assignee_user_id,
  }
}

const CARD_REF_COLUMNS = sql`c.id, c.title, c.status, c.due_at, c.assignee_user_id`

// ---------------------------------------------------------------------------------------------
// A10 -- dependencies
// ---------------------------------------------------------------------------------------------

export type DependencyLists = {
  blockedBy: Array<{ id: string; card: CardRef }>
  blocks: Array<{ id: string; card: CardRef }>
}

/** Both directions in one round trip: a `union all` over the same two indexes rather than two
 * queries the handler would have to await in turn. */
export async function getDependencies(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
): Promise<DependencyLists> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<CardRefRow & { dep_id: string; direction: 'blocked_by' | 'blocks' }>(
      sql`
        select d.id as dep_id, 'blocked_by' as direction, ${CARD_REF_COLUMNS}
        from app.card_dependencies d
        join app.cards c on c.id = d.blocked_by_card_id and c.deleted_at is null
        where d.department_id = ${departmentId} and d.card_id = ${cardId}
        union all
        select d.id as dep_id, 'blocks' as direction, ${CARD_REF_COLUMNS}
        from app.card_dependencies d
        join app.cards c on c.id = d.card_id and c.deleted_at is null
        where d.department_id = ${departmentId} and d.blocked_by_card_id = ${cardId}
      `,
    )
    return {
      blockedBy: rows
        .filter((r) => r.direction === 'blocked_by')
        .map((r) => ({ id: r.dep_id, card: toCardRef(r) })),
      blocks: rows
        .filter((r) => r.direction === 'blocks')
        .map((r) => ({ id: r.dep_id, card: toCardRef(r) })),
    }
  })
}

/** Every edge in the department -- what the Gantt draws its arrows from, and what the cycle guard
 * walks. One query, bounded; a department's dependency graph is orders of magnitude smaller than
 * its card list. */
export async function listDependencyEdges(
  ctx: RequestContext,
  departmentId: string,
): Promise<Array<{ id: string; cardId: string; blockedByCardId: string }>> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      card_id: string
      blocked_by_card_id: string
    }>(
      sql`select d.id, d.card_id, d.blocked_by_card_id from app.card_dependencies d
          join app.cards c on c.id = d.card_id and c.deleted_at is null
          join app.cards blocker on blocker.id = d.blocked_by_card_id and blocker.deleted_at is null
          where d.department_id = ${departmentId}
          limit 5000`,
    )
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      blockedByCardId: r.blocked_by_card_id,
    }))
  })
}

export type AddDependencyResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'cycle' | 'duplicate' }

/**
 * Serialize graph decisions per department inside the insert's transaction. A shared lock on
 * existing edges cannot protect an absent edge: opposing concurrent inserts could otherwise both
 * pass the cycle check. The next writer reads the preceding writer's committed graph.
 */
export async function addDependency(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  blockedByCardId: string,
  actorUserId: string,
): Promise<AddDependencyResult> {
  if (cardId === blockedByCardId) return { ok: false, reason: 'cycle' }
  return withContext(ctx, async (tx) => {
    await tx.raw(
      sql`select pg_advisory_xact_lock(hashtextextended(${`work-dependencies:${departmentId}`}, 0))`,
    )
    const both = await tx.raw<{ id: string }>(
      sql`select id from app.cards
          where department_id = ${departmentId} and deleted_at is null
            and id in (${cardId}, ${blockedByCardId}) order by id for share`,
    )
    if (both.length !== 2) return { ok: false, reason: 'not_found' as const }

    const edges = await tx.raw<{ card_id: string; blocked_by_card_id: string }>(
      sql`select card_id, blocked_by_card_id from app.card_dependencies
          where department_id = ${departmentId} for share`,
    )
    if (edges.some((e) => e.card_id === cardId && e.blocked_by_card_id === blockedByCardId)) {
      return { ok: false, reason: 'duplicate' as const }
    }
    const cycles = wouldCreateDependencyCycle(
      edges.map((e) => ({
        cardId: e.card_id,
        blockedByCardId: e.blocked_by_card_id,
      })),
      cardId,
      blockedByCardId,
    )
    if (cycles) return { ok: false, reason: 'cycle' as const }

    const id = randomUUID()
    await tx.raw(
      sql`insert into app.card_dependencies
            (id, department_id, card_id, blocked_by_card_id, created_by_user_id)
          values (${id}, ${departmentId}, ${cardId}, ${blockedByCardId}, ${actorUserId})`,
    )
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values (${randomUUID()}, ${departmentId}, ${cardId}, ${actorUserId}, 'dependency',
                  ${JSON.stringify({ blockedByCardId })}::jsonb)`,
    )
    tx.audit({
      action: 'work.dependency_added',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      after: { blockedByCardId },
    })
    return { ok: true as const, id }
  })
}

export async function removeDependency(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  dependencyId: string,
  actorUserId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    // A hard removal rather than a soft one: an edge carries no history worth keeping, and the card
    // activity row below is the record that it was ever there.
    const rows = await tx.raw<{ blocked_by_card_id: string }>(
      sql`delete from app.card_dependencies
          where id = ${dependencyId} and department_id = ${departmentId}
            and (card_id = ${cardId} or blocked_by_card_id = ${cardId})
          returning blocked_by_card_id`,
    )
    if (rows.length === 0) return false
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values (${randomUUID()}, ${departmentId}, ${cardId}, ${actorUserId}, 'dependency',
                  ${JSON.stringify({ removed: rows[0]!.blocked_by_card_id })}::jsonb)`,
    )
    tx.audit({
      action: 'work.dependency_removed',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      before: { blockedByCardId: rows[0]!.blocked_by_card_id },
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// A3 -- the light time log
// ---------------------------------------------------------------------------------------------

export type TimeLogEntry = {
  id: string
  cardId: string
  userId: string
  minutes: number
  spentOn: string
  note: string | null
  createdAt: string
}

export async function getTimeLog(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
): Promise<{
  entries: TimeLogEntry[]
  loggedMin: number
  estimateMin: number | null
} | null> {
  return withContext(ctx, async (tx) => {
    const cards = await tx.raw<{ estimate_min: number | null }>(
      sql`select estimate_min from app.cards
          where id = ${cardId} and department_id = ${departmentId} and deleted_at is null`,
    )
    if (cards.length === 0) return null
    const rows = await tx.raw<{
      id: string
      card_id: string
      user_id: string
      minutes: number
      spent_on: Date | string
      note: string | null
      created_at: Date
    }>(
      sql`select id, card_id, user_id, minutes, spent_on, note, created_at
          from app.card_time_logs
          where card_id = ${cardId} and deleted_at is null
          order by spent_on desc, created_at desc
          limit 500`,
    )
    const entries = rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      userId: r.user_id,
      minutes: Number(r.minutes),
      spentOn: typeof r.spent_on === 'string' ? r.spent_on : toIsoDate(r.spent_on),
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
    }))
    return {
      entries,
      loggedMin: entries.reduce((sum, e) => sum + e.minutes, 0),
      estimateMin: cards[0]!.estimate_min === null ? null : Number(cards[0]!.estimate_min),
    }
  })
}

export async function addTimeLog(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  userId: string,
  input: {
    minutes: number
    spentOn?: string | undefined
    note?: string | undefined
  },
): Promise<string | null> {
  return withContext(ctx, async (tx) => {
    if (!(await cardVisible(tx, departmentId, cardId))) return null
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.card_time_logs
            (id, department_id, card_id, user_id, minutes, spent_on, note)
          values (${id}, ${departmentId}, ${cardId}, ${userId}, ${input.minutes},
                  coalesce(${input.spentOn ?? null}::date, (now() at time zone 'Asia/Tashkent')::date),
                  ${input.note ?? null})`,
    )
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values (${randomUUID()}, ${departmentId}, ${cardId}, ${userId}, 'time',
                  ${JSON.stringify({ minutes: input.minutes })}::jsonb)`,
    )
    tx.audit({
      action: 'work.time_logged',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      after: { minutes: input.minutes },
    })
    return id
  })
}

export async function removeTimeLog(
  ctx: RequestContext,
  departmentId: string,
  logId: string,
  userId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string; card_id: string; minutes: number }>(
      sql`update app.card_time_logs set deleted_at = now()
          where id = ${logId} and department_id = ${departmentId} and user_id = ${userId}
            and deleted_at is null
          returning id, card_id, minutes`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'work.time_log_removed',
      subjectType: 'card',
      subjectId: rows[0]!.card_id,
      departmentId,
      before: { minutes: Number(rows[0]!.minutes) },
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// 7.4 -- reminders
// ---------------------------------------------------------------------------------------------

export type ReminderRow = {
  id: string
  cardId: string
  remindAt: string
  note: string | null
  sentAt: string | null
}

export async function listReminders(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  userId: string,
): Promise<ReminderRow[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      card_id: string
      remind_at: Date
      note: string | null
      sent_at: Date | null
    }>(
      sql`select r.id, r.card_id, r.remind_at, r.note, r.sent_at from app.card_reminders r
          join app.cards c on c.id = r.card_id and c.deleted_at is null
          where r.department_id = ${departmentId} and r.card_id = ${cardId} and r.user_id = ${userId}
            and r.deleted_at is null
          order by r.remind_at asc`,
    )
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      remindAt: new Date(r.remind_at).toISOString(),
      note: r.note,
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    }))
  })
}

export async function addReminder(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  userId: string,
  input: { remindAt: string; note?: string | undefined },
): Promise<string | null> {
  return withContext(ctx, async (tx) => {
    if (!(await cardVisible(tx, departmentId, cardId))) return null
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.card_reminders (id, department_id, card_id, user_id, remind_at, note)
          values (${id}, ${departmentId}, ${cardId}, ${userId}, ${input.remindAt}, ${input.note ?? null})`,
    )
    tx.audit({
      action: 'work.reminder_set',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      after: { remindAt: input.remindAt },
    })
    return id
  })
}

export async function removeReminder(
  ctx: RequestContext,
  departmentId: string,
  reminderId: string,
  userId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string; card_id: string }>(
      sql`update app.card_reminders set deleted_at = now()
          where id = ${reminderId} and department_id = ${departmentId} and user_id = ${userId}
            and deleted_at is null
          returning id, card_id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'work.reminder_cleared',
      subjectType: 'card',
      subjectId: rows[0]!.card_id,
      departmentId,
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// 7.2 -- templates
// ---------------------------------------------------------------------------------------------

export type TemplateRow = {
  id: string
  kind: WorkTemplateKind
  scope: WorkTemplateScope
  ownerUserId: string
  name: string
  description: string | null
  payload: Record<string, unknown>
  useCount: number
  createdAt: string
}

export async function listTemplates(
  ctx: RequestContext,
  departmentId: string,
  kind?: WorkTemplateKind,
): Promise<TemplateRow[]> {
  return withContext(ctx, async (tx) => {
    const kindFilter = kind ? sql` and kind = ${kind}` : sql``
    const rows = await tx.raw<{
      id: string
      kind: WorkTemplateKind
      scope: WorkTemplateScope
      owner_user_id: string
      name: string
      description: string | null
      payload: Record<string, unknown>
      use_count: number
      created_at: Date
    }>(
      // RLS already restricts this to department templates plus the viewer's own personal ones
      // (`work_templates_read` in 0905; operation-specific writes in 2009), so the query does not
      // repeat that rule in SQL -- doing it
      // twice is how the two copies eventually disagree.
      sql`select id, kind, scope, owner_user_id, name, description, payload, use_count, created_at
          from app.work_templates
          where department_id = ${departmentId} and deleted_at is null${kindFilter}
          order by scope asc, use_count desc, name asc
          limit 200`,
    )
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      scope: r.scope,
      ownerUserId: r.owner_user_id,
      name: r.name,
      description: r.description,
      payload: r.payload ?? {},
      useCount: Number(r.use_count ?? 0),
      createdAt: new Date(r.created_at).toISOString(),
    }))
  })
}

export async function getTemplate(
  ctx: RequestContext,
  departmentId: string,
  id: string,
): Promise<TemplateRow | null> {
  const all = await withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      kind: WorkTemplateKind
      scope: WorkTemplateScope
      owner_user_id: string
      name: string
      description: string | null
      payload: Record<string, unknown>
      use_count: number
      created_at: Date
    }>(
      sql`select id, kind, scope, owner_user_id, name, description, payload, use_count, created_at
          from app.work_templates
          where id = ${id} and department_id = ${departmentId} and deleted_at is null`,
    )
    return rows
  })
  const row = all[0]
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    payload: row.payload ?? {},
    useCount: Number(row.use_count ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export async function createTemplate(
  ctx: RequestContext,
  departmentId: string,
  ownerUserId: string,
  input: {
    kind: WorkTemplateKind
    scope: WorkTemplateScope
    name: string
    description?: string | undefined
    payload: Record<string, unknown>
  },
): Promise<string> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.work_templates
            (id, department_id, kind, scope, owner_user_id, name, description, payload)
          values (${id}, ${departmentId}, ${input.kind}, ${input.scope}, ${ownerUserId},
                  ${input.name}, ${input.description ?? null}, ${JSON.stringify(input.payload)}::jsonb)`,
    )
    tx.audit({
      action: 'work.template_created',
      subjectType: 'work_template',
      subjectId: id,
      departmentId,
      after: { name: input.name, kind: input.kind, scope: input.scope },
    })
    return id
  })
}

export async function patchTemplate(
  ctx: RequestContext,
  departmentId: string,
  id: string,
  patch: {
    name?: string | undefined
    description?: string | null | undefined
    scope?: WorkTemplateScope | undefined
    payload?: Record<string, unknown> | undefined
  },
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const sets: SQL[] = [sql`updated_at = now()`]
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`)
    if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`)
    if (patch.scope !== undefined) sets.push(sql`scope = ${patch.scope}`)
    if (patch.payload !== undefined) {
      sets.push(sql`payload = ${JSON.stringify(patch.payload)}::jsonb`)
    }
    const rows = await tx.raw<{ id: string }>(
      sql`update app.work_templates set ${sql.join(sets, sql`, `)}
          where id = ${id} and department_id = ${departmentId} and deleted_at is null
          returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'work.template_updated',
      subjectType: 'work_template',
      subjectId: id,
      departmentId,
      after: patch,
    })
    return true
  })
}

export async function archiveTemplate(
  ctx: RequestContext,
  departmentId: string,
  id: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.work_templates set deleted_at = now(), updated_at = now()
          where id = ${id} and department_id = ${departmentId} and deleted_at is null
          returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'work.template_removed',
      subjectType: 'work_template',
      subjectId: id,
      departmentId,
    })
    return true
  })
}

export async function bumpTemplateUse(
  ctx: RequestContext,
  departmentId: string,
  id: string,
): Promise<void> {
  await withContext(ctx, async (tx) => {
    await tx.raw(
      sql`update app.work_templates set use_count = use_count + 1
          where id = ${id} and department_id = ${departmentId}`,
    )
  })
}

/** The gallery's "most used first" ordering is only honest if a template that fails validation never
 * counts as used, so the checklist lines are appended in the same transaction as the card create.
 * Returns the ids of the checklist rows written, for the caller's audit line. */
export async function applyCardTemplateChecklist(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  payload: CardTemplatePayload,
): Promise<number> {
  return withContext(ctx, (tx) => applyCardTemplateChecklistInTx(tx, departmentId, cardId, payload))
}

async function applyCardTemplateChecklistInTx(
  tx: Tx,
  departmentId: string,
  cardId: string,
  payload: CardTemplatePayload,
): Promise<number> {
  const lines = payload.checklist ?? []
  if (lines.length === 0) return 0
  // One multi-row insert, never one statement per line (I-14).
  const values = lines.map(
    (text, index) =>
      sql`(${randomUUID()}, ${departmentId}, ${cardId}, ${text}, ${`a${index.toString().padStart(4, '0')}`})`,
  )
  await tx.raw(
    sql`insert into app.card_checklist_items (id, department_id, card_id, text, order_key)
          values ${sql.join(values, sql`, `)}`,
  )
  return lines.length
}

export async function createFromCardTemplate(
  ctx: RequestContext,
  departmentId: string,
  templateId: string,
  input: {
    assigneeUserId?: string | null | undefined
    giverUserId?: string | null | undefined
    projectId?: string | null | undefined
    dueAt?: string | null | undefined
  },
) {
  return withContext(ctx, async (tx) => {
    const consumed = await tx.raw<{ payload: unknown }>(
      sql`select app.consume_card_template(${templateId}::uuid) as payload`,
    )
    if (consumed[0]?.payload == null) return { ok: false as const, reason: 'not_found' as const }
    const parsed = cardTemplatePayloadSchema.safeParse(consumed[0].payload)
    if (!parsed.success)
      throw Object.assign(new Error('Template payload is invalid'), { statusCode: 422 })
    const payload = parsed.data
    const card = await createCardInTx(ctx, tx, {
      departmentId,
      title: payload.title,
      description: payload.description ?? undefined,
      kind: input.projectId ? 'project_task' : 'task',
      assigneeUserId: input.assigneeUserId ?? null,
      giverUserId: input.giverUserId ?? ctx.userId!,
      projectId: input.projectId ?? null,
      projectScope: input.projectId ? 'objective' : 'none',
      priority: payload.priority ?? 'none',
      startAt: null,
      dueAt:
        input.dueAt !== undefined
          ? input.dueAt
          : payload.dueInDays == null
            ? null
            : new Date(Date.now() + payload.dueInDays * 86_400_000).toISOString(),
      labels: payload.labels ?? [],
      links: [],
      orderKey: undefined,
      createdByUserId: ctx.userId!,
      estimateMin: payload.estimateMin ?? null,
      source: 'template',
    })
    const checklistCount = await applyCardTemplateChecklistInTx(tx, departmentId, card.id, payload)
    tx.audit({
      action: 'work.template_used',
      subjectType: 'work_template',
      subjectId: templateId,
      departmentId,
      after: { cardId: card.id, checklistCount },
    })
    return { ok: true as const, id: card.id }
  })
}

// ---------------------------------------------------------------------------------------------
// A9 -- the focus list
// ---------------------------------------------------------------------------------------------

export async function getFocusList(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
): Promise<Array<{ cardId: string; position: number; card: CardRef }>> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<CardRefRow & { position: number }>(
      sql`select f.position, ${CARD_REF_COLUMNS}
          from app.focus_pins f
          join app.cards c on c.id = f.card_id and c.deleted_at is null
          where f.department_id = ${departmentId} and f.user_id = ${userId}
          order by f.position asc, f.created_at asc, f.id asc`,
    )
    return rows.map((r) => ({
      cardId: r.id,
      position: Number(r.position),
      card: toCardRef(r),
    }))
  })
}

export type AddFocusResult = { ok: true } | { ok: false; reason: 'not_found' | 'full' }

export async function addFocusPin(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  cardId: string,
): Promise<AddFocusResult> {
  return withContext(ctx, async (tx) => {
    await tx.raw(
      sql`select pg_advisory_xact_lock(hashtextextended(${`work-focus:${departmentId}:${userId}`}, 0))`,
    )
    if (!(await cardVisible(tx, departmentId, cardId)))
      return { ok: false as const, reason: 'not_found' as const }
    // A deleted card must not occupy an invisible slot forever.
    await tx.raw(sql`delete from app.focus_pins f using app.cards c
      where f.card_id = c.id and f.department_id = ${departmentId} and f.user_id = ${userId}
        and c.deleted_at is not null`)
    const existing = await tx.raw<{ cnt: number; already: number }>(
      sql`select count(*) as cnt, count(*) filter (where card_id = ${cardId}) as already
          from app.focus_pins where department_id = ${departmentId} and user_id = ${userId}`,
    )
    const count = Number(existing[0]?.cnt ?? 0)
    const already = Number(existing[0]?.already ?? 0)
    if (already > 0) return { ok: true as const }
    if (count >= FOCUS_MAX) return { ok: false as const, reason: 'full' as const }
    await tx.raw(sql`update app.focus_pins set position = position + 1
      where department_id = ${departmentId} and user_id = ${userId}`)
    await tx.raw(
      sql`insert into app.focus_pins (id, department_id, user_id, card_id, position)
          values (${randomUUID()}, ${departmentId}, ${userId}, ${cardId}, 0)
          on conflict (user_id, card_id) do nothing`,
    )
    tx.audit({
      action: 'work.focus_added',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      after: { userId },
    })
    tx.emit({
      type: 'work.focus.updated',
      departmentId,
      payload: { userId, actorUserId: userId },
    })
    return { ok: true as const }
  })
}

export async function removeFocusPin(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  cardId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    await tx.raw(
      sql`select pg_advisory_xact_lock(hashtextextended(${`work-focus:${departmentId}:${userId}`}, 0))`,
    )
    const rows = await tx.raw<{ id: string }>(
      sql`delete from app.focus_pins
          where department_id = ${departmentId} and user_id = ${userId} and card_id = ${cardId}
          returning id`,
    )
    if (rows.length) {
      tx.audit({
        action: 'work.focus_removed',
        subjectType: 'card',
        subjectId: cardId,
        departmentId,
        before: { userId },
      })
      tx.emit({
        type: 'work.focus.updated',
        departmentId,
        payload: { userId, actorUserId: userId },
      })
    }
    return rows.length > 0
  })
}

export async function reorderFocusPins(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  cardIds: readonly string[],
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    await tx.raw(
      sql`select pg_advisory_xact_lock(hashtextextended(${`work-focus:${departmentId}:${userId}`}, 0))`,
    )
    const current = await tx.raw<{
      card_id: string
    }>(sql`select f.card_id from app.focus_pins f
      join app.cards c on c.id = f.card_id and c.deleted_at is null
      where f.department_id = ${departmentId} and f.user_id = ${userId}`)
    if (
      new Set(cardIds).size !== cardIds.length ||
      current.length !== cardIds.length ||
      current.some((row) => !cardIds.includes(row.card_id))
    )
      return false
    if (cardIds.length === 0) return true
    // One statement for the whole list: a `values` list joined back to the table, never one UPDATE
    // per card (I-14).
    const values = cardIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`)
    await tx.raw(
      sql`update app.focus_pins f set position = v.pos
          from (values ${sql.join(values, sql`, `)}) as v(card_id, pos)
          where f.card_id = v.card_id
            and f.department_id = ${departmentId} and f.user_id = ${userId}`,
    )
    tx.audit({
      action: 'work.focus_reordered',
      subjectType: 'user',
      subjectId: userId,
      departmentId,
      after: { cardIds },
    })
    tx.emit({
      type: 'work.focus.updated',
      departmentId,
      payload: { userId, actorUserId: userId },
    })
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// A4 -- capacity and the workload grid
// ---------------------------------------------------------------------------------------------

export type CapacityRow = {
  userId: string
  weeklyHours: number
  isDefault: boolean
}

export async function listCapacity(
  ctx: RequestContext,
  departmentId: string,
): Promise<CapacityRow[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ user_id: string; weekly_hours: string | null }>(
      sql`select m.user_id, wc.weekly_hours
          from app.memberships m
          left join app.work_capacity wc
            on wc.user_id = m.user_id and wc.department_id = m.department_id
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null`,
    )
    return rows.map((r) => ({
      userId: r.user_id,
      weeklyHours: r.weekly_hours === null ? DEFAULT_WEEKLY_CAPACITY_HOURS : Number(r.weekly_hours),
      isDefault: r.weekly_hours === null,
    }))
  })
}

export async function putCapacity(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  weeklyHours: number,
  actorUserId: string,
): Promise<void> {
  await withContext(ctx, async (tx) => {
    await tx.raw(
      sql`insert into app.work_capacity
            (id, department_id, user_id, weekly_hours, updated_by_user_id)
          values (${randomUUID()}, ${departmentId}, ${userId}, ${weeklyHours}, ${actorUserId})
          on conflict (department_id, user_id) do update
            set weekly_hours = excluded.weekly_hours,
                updated_by_user_id = excluded.updated_by_user_id,
                updated_at = now()`,
    )
    tx.audit({
      action: 'work.capacity_set',
      subjectType: 'membership',
      subjectId: userId,
      departmentId,
      after: { weeklyHours },
    })
  })
}

export type WorkloadBucket = {
  userId: string | null
  weekStart: string
  estimateMinutes: number
  cardCount: number
  overdueCount: number
}

export type WorkloadRaw = {
  buckets: WorkloadBucket[]
  noDueDate: number
  noEstimate: number
  /** Every open card in the department, so the grid can say honestly how much of the work its
   * estimate-based colouring actually covers (v1.1 critique SEV2 #3). */
  openTotal: number
}

/**
 * Two queries for the whole grid, whatever the department's size: one `group by (assignee, week)`
 * over the window, and one pair of counts for the "Hisobga olinmagan" panel. Never one query per
 * person or per week (I-14) -- a 26-person department over six weeks would otherwise be 156 round
 * trips to draw one screen.
 */
export async function getWorkloadBuckets(
  ctx: RequestContext,
  departmentId: string,
  fromIso: string,
  toIso: string,
): Promise<WorkloadRaw> {
  return withContext(ctx, async (tx) => {
    const buckets = await tx.raw<{
      assignee_user_id: string | null
      week_start: Date | string
      estimate_minutes: string
      card_count: string
      overdue_count: string
    }>(
      sql`select c.assignee_user_id,
                 (date_trunc('week', c.due_at at time zone 'Asia/Tashkent'))::date as week_start,
                 coalesce(sum(c.estimate_min), 0) as estimate_minutes,
                 count(*) as card_count,
                 count(*) filter (where c.due_at < now()) as overdue_count
          from app.cards c
          where c.department_id = ${departmentId}
            and c.deleted_at is null
            and c.status = 'active'
            and c.due_at >= ${fromIso} and c.due_at < ${toIso}
          group by 1, 2`,
    )
    const unscheduled = await tx.raw<{
      no_due: string
      no_estimate: string
      open_total: string
    }>(
      sql`select count(*) filter (where due_at is null) as no_due,
                 count(*) filter (where estimate_min is null) as no_estimate,
                 count(*) as open_total
          from app.cards
          where department_id = ${departmentId} and deleted_at is null and status = 'active'`,
    )
    return {
      buckets: buckets.map((b) => ({
        userId: b.assignee_user_id,
        weekStart: typeof b.week_start === 'string' ? b.week_start : toIsoDate(b.week_start),
        estimateMinutes: Number(b.estimate_minutes),
        cardCount: Number(b.card_count),
        overdueCount: Number(b.overdue_count),
      })),
      noDueDate: Number(unscheduled[0]?.no_due ?? 0),
      noEstimate: Number(unscheduled[0]?.no_estimate ?? 0),
      openTotal: Number(unscheduled[0]?.open_total ?? 0),
    }
  })
}

// ---------------------------------------------------------------------------------------------
// A8 -- the bulk bar
// ---------------------------------------------------------------------------------------------

export type BulkPatch = {
  assigneeUserId?: string | null | undefined
  priority?: CardDTO['priority'] | undefined
  dueAt?: string | null | undefined
  status?: CardDTO['status'] | undefined
  estimateMin?: number | null | undefined
  addLabelIds?: string[] | undefined
  removeLabelIds?: string[] | undefined
  /** Internal undo replacement; the ordinary bulk API exposes only add/remove set operations. */
  restoreLabelIds?: string[] | undefined
}

export type BulkPrevious = {
  id: string
  assigneeUserId: string | null
  priority: CardDTO['priority']
  dueAt: string | null
  status: CardDTO['status']
  estimateMin: number | null
  labels: string[]
}

export type BulkResult = {
  updated: string[]
  forbidden: string[]
  notFound: string[]
  undo: BulkPrevious[]
}

/**
 * One transaction for the whole selection. The ownership decision still happens per card and with
 * the same rule the single-card PATCH uses -- the caller passes `mayEdit`, which is
 * `can(actor, 'update', {kind:'owned', ownerUserIds})` -- but the *rows* are read once and written
 * once, so forty selected cards cost two statements rather than eighty.
 */
export async function bulkPatchCards(
  ctx: RequestContext,
  departmentId: string,
  ids: readonly string[],
  patch: BulkPatch,
  actorUserId: string,
  mayEdit: (ownerUserIds: string[]) => boolean,
): Promise<BulkResult> {
  return withContext(ctx, (tx) =>
    bulkPatchCardsInTx(tx, departmentId, ids, patch, actorUserId, mayEdit),
  )
}

/** Apply one set inside a caller's atomic undo transaction. Never open a nested connection. */
export async function bulkPatchCardsInTx(
  tx: Tx,
  departmentId: string,
  ids: readonly string[],
  patch: BulkPatch,
  actorUserId: string,
  mayEdit: (ownerUserIds: string[]) => boolean,
): Promise<BulkResult> {
  const rows = await tx.raw<{
    id: string
    assignee_user_id: string | null
    giver_user_id: string | null
    created_by_user_id: string
    priority: CardDTO['priority']
    due_at: Date | null
    status: CardDTO['status']
    estimate_min: number | null
    labels: string[]
  }>(
    sql`select id, assignee_user_id, giver_user_id, created_by_user_id, priority, due_at, status,
                 estimate_min, labels
          from app.cards
          where department_id = ${departmentId} and deleted_at is null
            and id = any(${sql.param([...ids])}::uuid[])
          for update`,
  )
  const found = new Map(rows.map((r) => [r.id, r]))
  const notFound = ids.filter((id) => !found.has(id))
  const forbidden: string[] = []
  const updatable: typeof rows = []
  for (const row of rows) {
    const owners = [row.created_by_user_id, row.giver_user_id, row.assignee_user_id].filter(
      (id): id is string => Boolean(id),
    )
    if (mayEdit(owners)) updatable.push(row)
    else forbidden.push(row.id)
  }
  if (updatable.length === 0) {
    return { updated: [], forbidden, notFound: [...notFound], undo: [] }
  }

  await lockActiveCardTargets(
    tx,
    departmentId,
    typeof patch.assigneeUserId === 'string' &&
      updatable.some((row) => row.assignee_user_id !== patch.assigneeUserId)
      ? [patch.assigneeUserId]
      : [],
  )
  await lockActiveCardLabels(
    tx,
    departmentId,
    [...new Set([...(patch.addLabelIds ?? []), ...(patch.restoreLabelIds ?? [])])].filter((id) =>
      updatable.some((row) => !row.labels.includes(id)),
    ),
  )

  const undo: BulkPrevious[] = updatable.map((r) => ({
    id: r.id,
    assigneeUserId: r.assignee_user_id,
    priority: r.priority,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    status: r.status,
    estimateMin: r.estimate_min === null ? null : Number(r.estimate_min),
    labels: r.labels ?? [],
  }))

  const sets: SQL[] = [sql`updated_at = now()`, sql`version = version + 1`]
  if (patch.assigneeUserId !== undefined) {
    sets.push(sql`assignee_user_id = ${patch.assigneeUserId}`)
  }
  if (patch.priority !== undefined) sets.push(sql`priority = ${patch.priority}`)
  if (patch.dueAt !== undefined) sets.push(sql`due_at = ${patch.dueAt}`)
  if (patch.estimateMin !== undefined) sets.push(sql`estimate_min = ${patch.estimateMin}`)
  if (patch.status !== undefined) {
    sets.push(sql`status = ${patch.status}`)
    sets.push(sql`done_at = ${patch.status === 'done' ? sql`now()` : null}`)
    sets.push(sql`archived_at = ${patch.status === 'archived' ? sql`now()` : null}`)
  }
  // Labels are a set operation, not a replacement: "add this label to the selection" must not
  // wipe the labels each card already carries, which a plain `labels = $1` would.
  if (patch.addLabelIds && patch.addLabelIds.length > 0) {
    sets.push(
      sql`labels = (
          select coalesce(array_agg(distinct l), '{}')
          from unnest(labels || ${sql.param(patch.addLabelIds)}::uuid[]) as l
        )`,
    )
  }
  if (patch.removeLabelIds && patch.removeLabelIds.length > 0) {
    sets.push(
      sql`labels = (
          select coalesce(array_agg(l), '{}')
          from unnest(labels) as l
          where not (l = any(${sql.param(patch.removeLabelIds)}::uuid[]))
        )`,
    )
  }
  if (patch.restoreLabelIds !== undefined)
    sets.push(sql`labels = ${sql.param([...new Set(patch.restoreLabelIds)])}::uuid[]`)

  const targetIds = updatable.map((r) => r.id)
  const updated = await tx.raw<{ id: string }>(
    sql`update app.cards set ${sql.join(sets, sql`, `)}
          where id = any(${sql.param(targetIds)}::uuid[])
          returning id`,
  )

  // One activity row per touched card, written as one multi-row insert.
  const activityValues = targetIds.map(
    (id) =>
      sql`(${randomUUID()}, ${departmentId}, ${id}, ${actorUserId}, 'bulk', ${JSON.stringify(
        bulkActivityData(patch),
      )}::jsonb)`,
  )
  await tx.raw(
    sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values ${sql.join(activityValues, sql`, `)}`,
  )

  tx.audit({
    action: 'work.cards_bulk_updated',
    subjectType: 'card',
    subjectId: targetIds[0] ?? null,
    departmentId,
    after: { count: targetIds.length, patch: bulkActivityData(patch) },
  })
  // Deliberately no outbox event. A bulk action is one considered act by one person over a
  // selection they are looking at; fanning it out as forty `work.card.updated` notifications --
  // or as one event whose recipients rule would have to pick a single card to stand for the set --
  // is exactly the noise that makes people mute an inbox (SPEC §11's own recipients reasoning).
  // The per-card activity rows above and the audit row are the record that it happened, and the
  // undo toast is the affordance that matters in the seconds after it does.

  return {
    updated: updated.map((r) => r.id),
    forbidden,
    notFound: [...notFound],
    undo,
  }
}

function bulkActivityData(patch: BulkPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.assigneeUserId !== undefined) out['assigneeUserId'] = patch.assigneeUserId
  if (patch.priority !== undefined) out['priority'] = patch.priority
  if (patch.dueAt !== undefined) out['dueAt'] = patch.dueAt
  if (patch.status !== undefined) out['status'] = patch.status
  if (patch.estimateMin !== undefined) out['estimateMin'] = patch.estimateMin
  if (patch.addLabelIds?.length) out['addLabelIds'] = patch.addLabelIds
  if (patch.removeLabelIds?.length) out['removeLabelIds'] = patch.removeLabelIds
  if (patch.restoreLabelIds !== undefined) out['labels'] = patch.restoreLabelIds
  return out
}

// ---------------------------------------------------------------------------------------------
// A11 -- goals
// ---------------------------------------------------------------------------------------------

export type GoalRow = {
  id: string
  title: string
  description: string | null
  metric: GoalMetric
  filter: string
  targetValue: number
  startsOn: string | null
  dueOn: string | null
  archivedAt: string | null
  createdAt: string
  version: number
}

export async function listGoals(
  ctx: RequestContext,
  departmentId: string,
  includeArchived: boolean,
): Promise<GoalRow[]> {
  return withContext(ctx, async (tx) => {
    const archivedFilter = includeArchived ? sql`` : sql` and archived_at is null`
    const rows = await tx.raw<{
      id: string
      title: string
      description: string | null
      metric: GoalMetric
      filter: string
      target_value: string
      starts_on: Date | string | null
      due_on: Date | string | null
      archived_at: Date | null
      created_at: Date
      version: number
    }>(
      sql`select id, title, description, metric, filter, target_value, starts_on, due_on,
                 archived_at, created_at, version
          from app.goals
          where department_id = ${departmentId} and deleted_at is null${archivedFilter}
          order by archived_at nulls first, due_on asc nulls last, created_at desc
          limit 200`,
    )
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      metric: r.metric,
      filter: r.filter ?? '',
      targetValue: Number(r.target_value),
      startsOn: r.starts_on === null ? null : asIsoDate(r.starts_on),
      dueOn: r.due_on === null ? null : asIsoDate(r.due_on),
      archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      version: r.version,
    }))
  })
}

export async function createGoal(
  ctx: RequestContext,
  departmentId: string,
  createdByUserId: string,
  input: {
    title: string
    description?: string | undefined
    metric: GoalMetric
    filter?: string | undefined
    targetValue: number
    startsOn?: string | null | undefined
    dueOn?: string | null | undefined
  },
): Promise<string> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.goals
            (id, department_id, title, description, metric, filter, target_value, starts_on, due_on,
             created_by_user_id)
          values (${id}, ${departmentId}, ${input.title}, ${input.description ?? null},
                  ${input.metric}, ${input.filter ?? ''}, ${input.targetValue},
                  ${input.startsOn ?? null}, ${input.dueOn ?? null}, ${createdByUserId})`,
    )
    tx.audit({
      action: 'work.goal_created',
      subjectType: 'goal',
      subjectId: id,
      departmentId,
      after: {
        title: input.title,
        metric: input.metric,
        targetValue: input.targetValue,
      },
    })
    return id
  })
}

export async function patchGoal(
  ctx: RequestContext,
  departmentId: string,
  id: string,
  patch: {
    title?: string | undefined
    description?: string | null | undefined
    metric?: GoalMetric | undefined
    filter?: string | undefined
    targetValue?: number | undefined
    startsOn?: string | null | undefined
    dueOn?: string | null | undefined
    archived?: boolean | undefined
  },
  expectedVersion: number | undefined,
): Promise<'ok' | 'not_found' | 'conflict'> {
  return withContext(ctx, async (tx) => {
    const sets: SQL[] = [sql`updated_at = now()`, sql`version = version + 1`]
    if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`)
    if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`)
    if (patch.metric !== undefined) sets.push(sql`metric = ${patch.metric}`)
    if (patch.filter !== undefined) sets.push(sql`filter = ${patch.filter}`)
    if (patch.targetValue !== undefined) sets.push(sql`target_value = ${patch.targetValue}`)
    if (patch.startsOn !== undefined) sets.push(sql`starts_on = ${patch.startsOn}`)
    if (patch.dueOn !== undefined) sets.push(sql`due_on = ${patch.dueOn}`)
    if (patch.archived !== undefined) {
      sets.push(sql`archived_at = ${patch.archived ? sql`now()` : null}`)
    }
    const guard = expectedVersion === undefined ? sql`` : sql` and version = ${expectedVersion}`
    const rows = await tx.raw<{ id: string }>(
      sql`update app.goals set ${sql.join(sets, sql`, `)}
          where id = ${id} and department_id = ${departmentId} and deleted_at is null${guard}
          returning id`,
    )
    if (rows.length === 0) {
      const exists = await tx.raw<{ id: string }>(
        sql`select id from app.goals
            where id = ${id} and department_id = ${departmentId} and deleted_at is null`,
      )
      return exists.length > 0 ? 'conflict' : 'not_found'
    }
    tx.audit({
      action: 'work.goal_updated',
      subjectType: 'goal',
      subjectId: id,
      departmentId,
      after: patch,
    })
    return 'ok'
  })
}

export async function deleteGoal(
  ctx: RequestContext,
  departmentId: string,
  id: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.goals set deleted_at = now(), updated_at = now()
          where id = ${id} and department_id = ${departmentId} and deleted_at is null
          returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({
      action: 'work.goal_removed',
      subjectType: 'goal',
      subjectId: id,
      departmentId,
    })
    return true
  })
}

/**
 * Compute one goal's current value from the cards its filter matches.
 *
 * The filter runs in JavaScript over the department's card list, exactly the way
 * `GET /api/v1/cards` already evaluates the same grammar (`modules/work/index.ts`) -- one shared
 * matcher, one meaning for `label:hisobot`. Every goal on a screen is computed from the *same*
 * already-loaded card array, so a page of eight goals is still one card query, not eight.
 */
export function computeGoalValue(
  metric: GoalMetric,
  filter: string,
  targetValue: number,
  window: { startsOn: string | null; dueOn: string | null },
  cards: readonly CardDTO[],
  toFilterable: (card: CardDTO) => FilterableCard,
  filterContext: {
    meUserId: string | null
    resolveUserIds: (token: string) => string[]
  },
): { currentValue: number; progress: number; matchedCards: number } {
  const query = filter.trim() ? parseFilterQuery(filter) : null
  const from = window.startsOn ? new Date(`${window.startsOn}T00:00:00.000Z`).getTime() : null
  const to = window.dueOn ? new Date(`${window.dueOn}T23:59:59.999Z`).getTime() : null

  const matched = cards.filter((card) => {
    if (query && !matchesFilterQuery(toFilterable(card), query, filterContext)) return false
    return true
  })

  const inWindow = (iso: string | null): boolean => {
    if (iso === null) return from === null && to === null
    const at = new Date(iso).getTime()
    if (from !== null && at < from) return false
    if (to !== null && at > to) return false
    return true
  }

  let currentValue: number
  if (metric === 'open_cards_max') {
    currentValue = matched.filter((c) => c.status === 'active').length
  } else {
    const completed = matched.filter(
      (c) => (c.status === 'done' || c.status === 'archived') && inWindow(c.doneAt),
    )
    if (metric === 'cards_done') {
      currentValue = completed.length
    } else if (metric === 'estimate_hours') {
      const minutes = completed.reduce((sum, c) => sum + (c.estimateMin ?? 0), 0)
      currentValue = Math.round((minutes / 60) * 10) / 10
    } else {
      // on_time_rate: of the completed cards that HAD a due date, how many landed on or before it.
      // Cards with no due date are excluded from both halves rather than counted as on time --
      // that is the denominator WALKTHROUGH-FINDINGS 4.1 found three different answers to.
      const withDue = completed.filter((c) => c.dueAt !== null && c.doneAt !== null)
      const onTime = withDue.filter((c) => new Date(c.doneAt!) <= new Date(c.dueAt!))
      currentValue = withDue.length === 0 ? 0 : Math.round((onTime.length / withDue.length) * 100)
    }
  }

  return {
    currentValue,
    progress: goalProgress(metric, currentValue, targetValue),
    matchedCards: matched.length,
  }
}

// ---------------------------------------------------------------------------------------------
// A7 -- the recurrence job's own reads and writes
// ---------------------------------------------------------------------------------------------

export type RecurringCardRow = {
  id: string
  departmentId: string
  title: string
  description: { format: 'markdown'; text: string } | null
  kind: 'task' | 'project_task'
  assigneeUserId: string | null
  giverUserId: string | null
  projectId: string | null
  projectScope: 'none' | 'objective' | 'subjective'
  priority: CardDTO['priority']
  labels: string[]
  estimateMin: number | null
  dueAt: string | null
  status: CardDTO['status']
  doneAt: string | null
  recurrence: unknown
  recurrenceSeriesId: string | null
  recurrenceIndex: number | null
  createdByUserId: string
  seriesCount: number
  /** True when a later instance of this series already exists, so the job never creates two. */
  hasNewerInstance: boolean
}

/** Every live series head across every department, with the two facts the job needs to decide
 * ("how many instances exist" and "is there already a newer one") resolved in the same query. */
export async function listRecurringCards(ctx: RequestContext): Promise<RecurringCardRow[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      department_id: string
      title: string
      description: { format: 'markdown'; text: string } | null
      kind: 'task' | 'project_task'
      assignee_user_id: string | null
      giver_user_id: string | null
      project_id: string | null
      project_scope: 'none' | 'objective' | 'subjective'
      priority: CardDTO['priority']
      labels: string[]
      estimate_min: number | null
      due_at: Date | null
      status: CardDTO['status']
      done_at: Date | null
      recurrence: unknown
      recurrence_series_id: string | null
      recurrence_index: number | null
      created_by_user_id: string
      series_count: string
      newer_count: string
    }>(
      sql`select c.id, c.department_id, c.title, c.description, c.kind, c.assignee_user_id,
                 c.giver_user_id, c.project_id, c.project_scope, c.priority, c.labels,
                 c.estimate_min, c.due_at, c.status, c.done_at, c.recurrence,
                 c.recurrence_series_id, c.recurrence_index, c.created_by_user_id,
                 coalesce(s.total, 1) as series_count, coalesce(s.newer, 0) as newer_count
          from app.cards c
          left join lateral (
            select count(*) as total,
                   count(*) filter (
                     where coalesce(sib.recurrence_index, 0) > coalesce(c.recurrence_index, 0)
                   ) as newer
            from app.cards sib
            where sib.recurrence_series_id = c.recurrence_series_id
              and sib.department_id = c.department_id
              and sib.deleted_at is null
          ) s on true
          where c.recurrence is not null and c.deleted_at is null
          limit 2000`,
    )
    return rows.map((r) => ({
      id: r.id,
      departmentId: r.department_id,
      title: r.title,
      description: r.description,
      kind: r.kind,
      assigneeUserId: r.assignee_user_id,
      giverUserId: r.giver_user_id,
      projectId: r.project_id,
      projectScope: r.project_scope,
      priority: r.priority,
      labels: r.labels ?? [],
      estimateMin: r.estimate_min === null ? null : Number(r.estimate_min),
      dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
      status: r.status,
      doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
      recurrence: r.recurrence,
      recurrenceSeriesId: r.recurrence_series_id,
      recurrenceIndex: r.recurrence_index === null ? null : Number(r.recurrence_index),
      createdByUserId: r.created_by_user_id,
      seriesCount: Number(r.series_count),
      hasNewerInstance: Number(r.newer_count) > 0,
    }))
  })
}

/** Reminders whose moment has passed and that nobody has sent. Claimed by stamping `sent_at` in the
 * same statement that selects them, so two workers can never send the same one twice. */
export async function claimDueReminders(
  ctx: RequestContext,
  limit: number,
): Promise<
  Array<{
    id: string
    departmentId: string
    cardId: string
    userId: string
    note: string | null
    cardTitle: string
  }>
> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      department_id: string
      card_id: string
      user_id: string
      note: string | null
      card_title: string
    }>(
      sql`with due as (
            select r.id from app.card_reminders r
            join app.cards c on c.id = r.card_id and c.deleted_at is null
            where r.sent_at is null and r.deleted_at is null and r.remind_at <= now()
            order by remind_at asc
            limit ${limit}
            for update of r skip locked
          )
          update app.card_reminders r set sent_at = now()
          from due, app.cards c
          where r.id = due.id and c.id = r.card_id and c.deleted_at is null
          returning r.id, r.department_id, r.card_id, r.user_id, r.note, c.title as card_title`,
    )
    return rows.map((r) => ({
      id: r.id,
      departmentId: r.department_id,
      cardId: r.card_id,
      userId: r.user_id,
      note: r.note,
      cardTitle: r.card_title,
    }))
  })
}

// ---------------------------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------------------------

async function cardVisible(tx: Tx, departmentId: string, cardId: string): Promise<boolean> {
  const rows = await tx.raw<{ one: number }>(
    sql`select 1 as one from app.cards
        where id = ${cardId} and department_id = ${departmentId} and deleted_at is null`,
  )
  return rows.length > 0
}

function toIsoDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10)
}

function asIsoDate(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : toIsoDate(value)
}

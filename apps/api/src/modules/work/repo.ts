// Postgres access for the work module, through `@devon/db`'s `withContext()`/`tx.raw()` directly
// (MODULE-GUIDE.md "API modules": never a direct import of another module's `Deps`, and a module's own
// `packages/db/src/schema/<name>.ts` is not reachable from `apps/api` at all -- `@devon/db`'s only
// export is `./src/index.ts`, and `schema/index.ts` never re-exports a module's tables). Every
// function opens its own `withContext()` transaction, exactly like `apps/api/src/db/repo.ts`.
import { randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { recurrenceRuleSchema, type RecurrenceRule } from '@devon/contracts'
import type { CardDTO, MemberSummary, SavedViewLayout } from './schemas.js'

// --- row shapes returned by hand-written SQL (snake_case, as Postgres sends them) ------------------

type CardRow = {
  id: string
  kind: 'task' | 'project_task'
  title: string
  description: { format: 'markdown'; text: string } | null
  assignee_user_id: string | null
  giver_user_id: string | null
  project_id: string | null
  project_scope: 'none' | 'objective' | 'subjective'
  status: 'active' | 'done' | 'archived'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  start_at: Date | null
  due_at: Date | null
  done_at: Date | null
  archived_at: Date | null
  order_key: string
  labels: string[]
  watchers: string[]
  links: Array<{ url: string; title: string; favicon: string | null }>
  created_by_user_id: string
  created_at: Date
  updated_at: Date
  version: number
  checklist_total: number
  checklist_done: number
  comment_count: number
  // v1.1 SPEC §7 -- all five computed by `cardSelect()`'s lateral joins, in the same query.
  estimate_min: number | null
  logged_min: number
  blocked_by_open: number
  blocks_count: number
  recurrence: unknown
  recurrence_series_id: string | null
  focus_pinned: boolean
}

function computeRisk(row: Pick<CardRow, 'status' | 'due_at'>): 'none' | 'at_risk' | 'overdue' {
  if (row.status !== 'active' || !row.due_at) return 'none'
  const due = new Date(row.due_at).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now <= 2 * 24 * 60 * 60 * 1000) return 'at_risk'
  return 'none'
}

function toCardDTO(row: CardRow): CardDTO {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    assigneeUserId: row.assignee_user_id,
    giverUserId: row.giver_user_id,
    projectId: row.project_id,
    projectScope: row.project_scope,
    status: row.status,
    priority: row.priority,
    risk: computeRisk(row),
    startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    doneAt: row.done_at ? new Date(row.done_at).toISOString() : null,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    orderKey: row.order_key,
    labels: row.labels ?? [],
    watchers: row.watchers ?? [],
    links: row.links ?? [],
    checklistTotal: Number(row.checklist_total ?? 0),
    checklistDone: Number(row.checklist_done ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
    // v1.1 SPEC §7. `recurrence` is parsed rather than trusted: the column is jsonb and a rule
    // written by an older build (or by hand) must not reach the client as a shape the contract
    // does not describe -- an unreadable rule reads as "no repeat", which is the fail-safe answer.
    estimateMin: row.estimate_min === null ? null : Number(row.estimate_min),
    loggedMin: Number(row.logged_min ?? 0),
    blockedByOpenCount: Number(row.blocked_by_open ?? 0),
    blocksCount: Number(row.blocks_count ?? 0),
    recurrence: parseRecurrence(row.recurrence),
    recurrenceSeriesId: row.recurrence_series_id,
    focusPinned: row.focus_pinned === true,
  }
}

/** `null` for anything `recurrenceRuleSchema` does not accept -- see `toCardDTO`'s note. */
export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (value === null || value === undefined) return null
  const parsed = recurrenceRuleSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * The card projection every read in this module shares. A function rather than a constant because
 * two of its columns are answers to "…for **this** viewer" (the focus pin) and the rest have to
 * arrive in the same round trip as the card itself (I-14: never a follow-up query per card).
 *
 * Five lateral joins on a table bounded at 5000 rows: each is an index lookup on the child table's
 * `card_id`, which is what `card_time_logs_card_idx`, `card_dependencies_edge_key`,
 * `card_dependencies_blocker_idx` and `focus_pins_person_card_key` exist for.
 */
function cardSelect(viewerUserId: string | null): SQL {
  return sql`
  select c.id, c.kind, c.title, c.description, c.assignee_user_id, c.giver_user_id, c.project_id,
    c.project_scope, c.status, c.priority, c.start_at, c.due_at, c.done_at, c.archived_at,
    c.order_key, c.labels, c.watchers, c.links, c.created_by_user_id, c.created_at, c.updated_at,
    c.version, c.estimate_min, c.recurrence, c.recurrence_series_id,
    coalesce(cl.total, 0) as checklist_total, coalesce(cl.done, 0) as checklist_done,
    coalesce(cm.cnt, 0) as comment_count,
    coalesce(tl.logged, 0) as logged_min,
    coalesce(db.open_blockers, 0) as blocked_by_open,
    coalesce(bl.blocking, 0) as blocks_count,
    coalesce(fp.pinned, false) as focus_pinned
  from app.cards c
  left join lateral (
    select count(*) as total, count(*) filter (where done_at is not null) as done
    from app.card_checklist_items where card_id = c.id and deleted_at is null
  ) cl on true
  left join lateral (
    select count(*) as cnt from app.card_comments where card_id = c.id and deleted_at is null
  ) cm on true
  left join lateral (
    select coalesce(sum(minutes), 0) as logged
    from app.card_time_logs where card_id = c.id and deleted_at is null
  ) tl on true
  left join lateral (
    -- A blocker that is done no longer blocks: the chip has to mean "still waiting", or every
    -- finished dependency would leave a permanent red mark on a card nobody is waiting for.
    select count(*) as open_blockers
    from app.card_dependencies d
    join app.cards b on b.id = d.blocked_by_card_id and b.deleted_at is null and b.status = 'active'
    where d.card_id = c.id
  ) db on true
  left join lateral (
    select count(*) as blocking from app.card_dependencies where blocked_by_card_id = c.id
  ) bl on true
  left join lateral (
    select true as pinned from app.focus_pins
    where card_id = c.id and user_id = ${viewerUserId}
    limit 1
  ) fp on true
`
}

export async function getMembers(
  ctx: RequestContext,
  departmentId: string,
): Promise<MemberSummary[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      user_id: string
      given_name: string
      family_name: string
      title: string | null
      avatar_key: string | null
      role: 'head' | 'member'
      unit_id: string | null
      unit_name: string | null
    }>(
      // v1.1 SPEC §3.3: the bo'lim comes back with the member, in the same query -- one left join,
      // never a second round trip per column (TECH-SPEC §16). `app.unit_roles` holds at most one
      // active assignment per person per department (the unique index in `0200_structure.sql`), so
      // the join cannot multiply rows.
      sql`select u.id as user_id, u.given_name, u.family_name, u.title, u.avatar_key, m.role,
                 un.id as unit_id, un.name as unit_name
          from app.memberships m
          join app.users u on u.id = m.user_id
          left join app.unit_roles ur
            on ur.user_id = u.id and ur.department_id = m.department_id and ur.deleted_at is null
          left join app.units un on un.id = ur.unit_id and un.deleted_at is null
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null
            and u.deleted_at is null
          order by (m.role = 'head') desc, u.given_name asc, u.family_name asc`,
    )
    return rows.map((r) => ({
      userId: r.user_id,
      givenName: r.given_name,
      familyName: r.family_name,
      title: r.title,
      avatarKey: r.avatar_key,
      role: r.role,
      unitId: r.unit_id,
      unitName: r.unit_name,
    }))
  })
}

export async function getLabels(
  ctx: RequestContext,
  departmentId: string,
): Promise<Array<{ id: string; name: string; colour: string }>> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string; name: string; colour: string }>(
      sql`select id, name, colour from app.labels
          where department_id = ${departmentId} and deleted_at is null order by name asc`,
    )
    return rows
  })
}

export async function getProjectNames(
  ctx: RequestContext,
  departmentId: string,
): Promise<Map<string, string>> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ id: string; title: string }>(
      sql`select id, title from app.projects where department_id = ${departmentId} and deleted_at is null`,
    )
    return new Map(rows.map((r) => [r.id, r.title]))
  })
}

/** Board + filterable-list source: every non-deleted card in the department, optionally excluding
 * `archived` (the People board never shows archived cards -- TECH-SPEC §3.2: "done cards leave the
 * board ... go to the person's archive"). Bounded to 5000 rows -- generous for this demo's ~200
 * cards and this build's stated scale target, revisited (a real SQL predicate compiler for the filter
 * grammar) if a department ever approaches it. */
export async function listCards(
  ctx: RequestContext,
  departmentId: string,
  options: { excludeArchived?: boolean } = {},
): Promise<CardDTO[]> {
  return withContext(ctx, async (tx) => {
    const statusFilter = options.excludeArchived ? sql`and c.status != 'archived'` : sql``
    const rows = await tx.raw<CardRow>(
      sql`${cardSelect(ctx.userId)}
          where c.department_id = ${departmentId} and c.deleted_at is null ${statusFilter}
          order by c.due_at asc nulls last, c.order_key asc
          limit 5000`,
    )
    return rows.map(toCardDTO)
  })
}

export async function getCard(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
): Promise<CardDTO | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<CardRow>(
      sql`${cardSelect(ctx.userId)}
          where c.department_id = ${departmentId} and c.id = ${cardId} and c.deleted_at is null`,
    )
    return rows[0] ? toCardDTO(rows[0]) : null
  })
}

/**
 * Is `cardId` a live card of `departmentId`, as this transaction is allowed to see it? (H1.2,
 * object-level access control.)
 *
 * `can()` proves the caller may act on *a* card of their own department; RLS keeps another
 * department's card rows out of their transaction. Neither says anything about a **child** write
 * that carries a card id straight from the request body into an insert: the child row is stamped
 * with the caller's own `department_id`, so RLS is satisfied and the insert succeeds even when the
 * card it points at belongs to somebody else. That is the exact shape of an OWASP BOLA, and this is
 * the predicate that closes it. Used inside the child write transactions themselves rather than in
 * the handlers, so a new child route cannot forget it.
 */
async function cardIsVisible(tx: Tx, departmentId: string, cardId: string): Promise<boolean> {
  const rows = await tx.raw<{ one: number }>(
    sql`select 1 as one from app.cards
        where id = ${cardId} and department_id = ${departmentId} and deleted_at is null`,
  )
  return rows.length > 0
}

/** The same predicate for a handler that needs to answer 404 before reading a card's children. */
export type CardOwners = { ownerUserIds: string[] }

/** The owner set `can()` needs for `{kind:'owned'}` -- giver, assignee and creator (v1.1 SPEC §2.1).
 * `null` when the card does not exist in this department, so the caller answers 404 exactly the way
 * every other card route does for a foreign id (H1.2). One indexed lookup on the primary key; never
 * called in a loop. */
export async function getCardOwners(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
): Promise<CardOwners | null> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      created_by_user_id: string
      giver_user_id: string | null
      assignee_user_id: string | null
    }>(sql`
      select created_by_user_id, giver_user_id, assignee_user_id
      from app.cards
      where id = ${cardId} and department_id = ${departmentId} and deleted_at is null
    `)
    const row = rows[0]
    if (!row) return null
    const owners = [row.created_by_user_id, row.giver_user_id, row.assignee_user_id].filter(
      (id): id is string => Boolean(id),
    )
    return { ownerUserIds: owners }
  })
}

/** The department's active member ids -- used to refuse a card assigned or given to somebody outside
 * it (`apps/api/test/integration/mass-assignment.test.ts`: "a card cannot be assigned to a user
 * outside the department"). One `= any(...)` lookup for both ids together, never one per id. */
export async function filterDepartmentMemberIds(
  ctx: RequestContext,
  departmentId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(userIds.filter(Boolean))]
  if (wanted.length === 0) return new Set()
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{ user_id: string }>(sql`
      select user_id from app.memberships
      where department_id = ${departmentId}
        and status = 'active'
        and user_id = any(${sql.param(wanted)}::uuid[])
    `)
    return new Set(rows.map((r) => r.user_id))
  })
}

export async function cardExists(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => cardIsVisible(tx, departmentId, cardId))
}

export async function getChecklist(ctx: RequestContext, cardId: string) {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      card_id: string
      parent_item_id: string | null
      text: string
      done_at: Date | null
      assignee_user_id: string | null
      due_at: Date | null
      order_key: string
      version: number
    }>(
      sql`select id, card_id, parent_item_id, text, done_at, assignee_user_id, due_at, order_key, version
          from app.card_checklist_items
          where card_id = ${cardId} and deleted_at is null
          order by order_key asc`,
    )
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      parentItemId: r.parent_item_id,
      text: r.text,
      doneAt: r.done_at ? new Date(r.done_at).toISOString() : null,
      assigneeUserId: r.assignee_user_id,
      dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
      orderKey: r.order_key,
      version: r.version,
    }))
  })
}

export async function getComments(ctx: RequestContext, cardId: string) {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      card_id: string
      author_user_id: string
      body: { format: 'markdown'; text: string }
      mentions: string[]
      edited_at: Date | null
      created_at: Date
    }>(
      sql`select id, card_id, author_user_id, body, mentions, edited_at, created_at
          from app.card_comments
          where card_id = ${cardId} and deleted_at is null
          order by created_at asc`,
    )
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      authorUserId: r.author_user_id,
      body: r.body,
      mentions: r.mentions ?? [],
      editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    }))
  })
}

export async function getActivity(ctx: RequestContext, cardId: string) {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      card_id: string
      actor_user_id: string | null
      kind: string
      data: Record<string, unknown>
      at: Date
    }>(
      sql`select id, card_id, actor_user_id, kind, data, at
          from app.card_activity where card_id = ${cardId} order by at asc`,
    )
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      actorUserId: r.actor_user_id,
      kind: r.kind,
      data: r.data ?? {},
      at: new Date(r.at).toISOString(),
    }))
  })
}

type CreateCardInput = {
  departmentId: string
  title: string
  description: string | undefined
  kind: 'task' | 'project_task' | undefined
  assigneeUserId: string | null | undefined
  /**
   * Who asked for this work. **Defaults to the creator** when the caller omits it -- v1.1
   * integration found every card made through the UI landing with `giver_user_id = null`: the
   * board's giver avatar had nobody to show, and the head's "Qaror kutmoqda" tile (which counts
   * cards *this head gave out*) could never see a card they had just assigned from the people table.
   *
   * "Given by nobody" is not a state this product has a meaning for -- a person creating a card is
   * asking for the work, whether they hand it to a colleague or keep it. The default lives here,
   * one level below every route and every client, so no future caller can reintroduce the hole:
   * `null` and `undefined` both mean "the creator", because neither has ever meant anything else.
   * A card can still be *re-given* afterwards (`patchCard`'s `giverUserId`), which is the only way
   * the field was ever meant to change hands.
   */
  giverUserId: string | null | undefined
  priority: CardRow['priority'] | undefined
  startAt: string | null | undefined
  dueAt: string | null | undefined
  labels: string[] | undefined
  links: CardRow['links'] | undefined
  projectId: string | null | undefined
  projectScope: CardRow['project_scope'] | undefined
  orderKey: string | undefined
  createdByUserId: string
  // v1.1 SPEC §7 (A3/A7). `recurrenceSeriesId`/`recurrenceIndex` are only ever passed by the
  // recurrence job creating the next instance of an existing series; a card created by a person is
  // always the head of its own series, which `createCard` stamps below.
  estimateMin?: number | null | undefined
  recurrence?: RecurrenceRule | null | undefined
  recurrenceSeriesId?: string | null | undefined
  recurrenceIndex?: number | null | undefined
  source?: 'manual' | 'ai' | 'telegram' | 'template' | undefined
}

export async function createCard(ctx: RequestContext, input: CreateCardInput): Promise<CardDTO> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    const description = input.description
      ? { format: 'markdown' as const, text: input.description }
      : null
    // `sql.param(arr)` binds the whole array as ONE driver parameter (node-postgres serialises a JS
    // array bound this way into a real Postgres array literal) -- interpolating the bare array as
    // `${arr}::uuid[]` instead lets drizzle's own `sql` tag apply its "expand into a parenthesized
    // value list" rule (built for `where col in (${arr})`), which for an *insert value* produces a
    // bare `record` -- `()::uuid[]` for an empty array (a flat syntax error) or `($1, $2)::uuid[]`
    // for a non-empty one ("cannot cast type record to uuid[]") -- confirmed live: quick-add crashed
    // every card create with zero labels, which is every quick-added card.
    await tx.raw(
      sql`insert into app.cards (
            id, department_id, kind, title, description, assignee_user_id, giver_user_id,
            project_id, project_scope, priority, start_at, due_at, labels, links,
            order_key, created_by_user_id, estimate_min, recurrence, recurrence_series_id,
            recurrence_index, source
          ) values (
            ${id}, ${input.departmentId}, ${input.kind ?? 'task'}, ${input.title},
            ${description ? JSON.stringify(description) : null}::jsonb,
            ${input.assigneeUserId ?? null}, ${input.giverUserId ?? input.createdByUserId},
            ${input.projectId ?? null}, ${input.projectScope ?? 'none'}, ${input.priority ?? 'none'},
            ${input.startAt ?? null}, ${input.dueAt ?? null},
            ${sql.param(input.labels ?? [])}::uuid[], ${JSON.stringify(input.links ?? [])}::jsonb,
            ${input.orderKey ?? 'a0'}, ${input.createdByUserId},
            ${input.estimateMin ?? null},
            ${input.recurrence ? JSON.stringify(input.recurrence) : null}::jsonb,
            ${input.recurrenceSeriesId ?? (input.recurrence ? id : null)},
            ${input.recurrenceIndex ?? (input.recurrence ? 1 : null)},
            ${input.source ?? 'manual'}
          )`,
    )
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values (${randomUUID()}, ${input.departmentId}, ${id}, ${input.createdByUserId}, 'created', ${JSON.stringify({ title: input.title })}::jsonb)`,
    )
    tx.audit({
      action: 'work.card_created',
      subjectType: 'card',
      subjectId: id,
      departmentId: input.departmentId,
      after: {
        title: input.title,
        assigneeUserId: input.assigneeUserId ?? null,
      },
    })
    // The notification registry (`notifications/registry.ts`) resolves "who cares" from the card
    // itself; the payload only has to name the card and the person who acted, so the registry can
    // keep the actor out of their own inbox.
    tx.emit({
      type: 'work.card.created',
      payload: { cardId: id, actorUserId: input.createdByUserId },
      departmentId: input.departmentId,
    })

    const rows = await tx.raw<CardRow>(sql`${cardSelect(ctx.userId)} where c.id = ${id}`)
    return toCardDTO(rows[0]!)
  })
}

type PatchCardInput = {
  title?: string | undefined
  description?: string | null | undefined
  assigneeUserId?: string | null | undefined
  giverUserId?: string | null | undefined
  priority?: CardRow['priority'] | undefined
  status?: CardRow['status'] | undefined
  startAt?: string | null | undefined
  dueAt?: string | null | undefined
  labels?: string[] | undefined
  links?: CardRow['links'] | undefined
  watchers?: string[] | undefined
  orderKey?: string | undefined
  estimateMin?: number | null | undefined
  recurrence?: RecurrenceRule | null | undefined
}

export type PatchCardResult =
  | { ok: true; card: CardDTO }
  | { ok: false; reason: 'not_found' | 'conflict' }

export async function patchCard(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  patch: PatchCardInput,
  expectedVersion: number | undefined,
  actorUserId: string,
): Promise<PatchCardResult> {
  return withContext(ctx, async (tx) => {
    const before = await tx.raw<CardRow>(
      sql`${cardSelect(ctx.userId)} where c.department_id = ${departmentId} and c.id = ${cardId} and c.deleted_at is null`,
    )
    const beforeRow = before[0]
    if (!beforeRow) return { ok: false, reason: 'not_found' }
    if (expectedVersion !== undefined && beforeRow.version !== expectedVersion) {
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
    if (patch.assigneeUserId !== undefined)
      sets.push(sql`assignee_user_id = ${patch.assigneeUserId}`)
    if (patch.giverUserId !== undefined) sets.push(sql`giver_user_id = ${patch.giverUserId}`)
    if (patch.priority !== undefined) sets.push(sql`priority = ${patch.priority}`)
    if (patch.startAt !== undefined) sets.push(sql`start_at = ${patch.startAt}`)
    if (patch.dueAt !== undefined) sets.push(sql`due_at = ${patch.dueAt}`)
    // sql.param(): see createCard's header -- interpolating the bare array here hits the exact same
    // "cannot cast type record to uuid[]" / empty-array syntax error bug.
    if (patch.labels !== undefined) sets.push(sql`labels = ${sql.param(patch.labels)}::uuid[]`)
    if (patch.links !== undefined) sets.push(sql`links = ${JSON.stringify(patch.links)}::jsonb`)
    if (patch.watchers !== undefined)
      sets.push(sql`watchers = ${sql.param(patch.watchers)}::uuid[]`)
    if (patch.orderKey !== undefined) sets.push(sql`order_key = ${patch.orderKey}`)
    if (patch.estimateMin !== undefined) sets.push(sql`estimate_min = ${patch.estimateMin}`)
    if (patch.recurrence !== undefined) {
      sets.push(
        sql`recurrence = ${patch.recurrence ? JSON.stringify(patch.recurrence) : null}::jsonb`,
      )
      // Turning a plain card into a repeating one makes it the head of its own series; turning the
      // repeat off leaves the pointer alone, so the instances already created keep their lineage
      // (stopping a repeat must never orphan work somebody has already started).
      if (patch.recurrence) {
        sets.push(sql`recurrence_series_id = coalesce(recurrence_series_id, ${cardId})`)
        sets.push(sql`recurrence_index = coalesce(recurrence_index, 1)`)
      }
    }
    if (patch.status !== undefined) {
      sets.push(sql`status = ${patch.status}`)
      sets.push(
        sql`done_at = ${patch.status === 'done' ? sql`now()` : patch.status === 'active' ? null : sql`done_at`}`,
      )
      sets.push(sql`archived_at = ${patch.status === 'archived' ? sql`now()` : null}`)
    }

    // v1.1 (the `concurrency-races` probe): the `beforeRow.version !== expectedVersion` check above
    // is a read, and a read cannot stop a second transaction that read the same version from also
    // writing -- both PATCHes sent with the identical stale version used to return 200 and the first
    // write was silently lost. The guard therefore moves *into* the UPDATE: `where version = <the
    // version the caller believed>` makes "check" and "act" one statement, so exactly one of two
    // concurrent writers matches a row and the other matches none and gets its 409. The read above
    // stays: it is what distinguishes "no such card" (404) from "someone beat you to it" (409), and
    // it is the `before` image the audit row carries.
    const versionGuard =
      expectedVersion === undefined ? sql`` : sql` and version = ${expectedVersion}`
    const updated = await tx.raw<{ id: string }>(
      sql`update app.cards set ${sql.join(sets, sql`, `)} where id = ${cardId}${versionGuard} returning id`,
    )
    if (updated.length === 0) return { ok: false, reason: 'conflict' }

    if (patch.status !== undefined && patch.status !== beforeRow.status) {
      await tx.raw(
        sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
            values (${randomUUID()}, ${departmentId}, ${cardId}, ${actorUserId}, 'status', ${JSON.stringify({ from: beforeRow.status, to: patch.status })}::jsonb)`,
      )
    }
    if (patch.assigneeUserId !== undefined && patch.assigneeUserId !== beforeRow.assignee_user_id) {
      await tx.raw(
        sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
            values (${randomUUID()}, ${departmentId}, ${cardId}, ${actorUserId}, 'assigned', ${JSON.stringify({ from: beforeRow.assignee_user_id, to: patch.assigneeUserId })}::jsonb)`,
      )
    }
    if (
      patch.dueAt !== undefined &&
      patch.dueAt !== (beforeRow.due_at ? new Date(beforeRow.due_at).toISOString() : null)
    ) {
      await tx.raw(
        sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
            values (${randomUUID()}, ${departmentId}, ${cardId}, ${actorUserId}, 'due', ${JSON.stringify({ to: patch.dueAt })}::jsonb)`,
      )
    }

    tx.audit({
      action: 'work.card_updated',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
      before: { title: beforeRow.title, status: beforeRow.status },
      after: patch,
    })
    // The inbox says *what* changed, not "a card changed" (SPEC §11) -- so the payload carries the
    // field names that actually moved, compared against the `before` image rather than simply
    // listing the keys the client sent (a PATCH that re-sends the same assignee is not a change).
    // `notifications/registry.ts` renders these in four locales; an empty list still notifies, with
    // a neutral sentence.
    const changes: string[] = []
    if (patch.status !== undefined && patch.status !== beforeRow.status) changes.push('status')
    if (patch.assigneeUserId !== undefined && patch.assigneeUserId !== beforeRow.assignee_user_id) {
      changes.push('assignee')
    }
    if (patch.giverUserId !== undefined && patch.giverUserId !== beforeRow.giver_user_id) {
      changes.push('giver')
    }
    const beforeDueIso = beforeRow.due_at ? new Date(beforeRow.due_at).toISOString() : null
    if (patch.dueAt !== undefined && patch.dueAt !== beforeDueIso) changes.push('dueAt')
    if (patch.priority !== undefined && patch.priority !== beforeRow.priority)
      changes.push('priority')
    if (patch.title !== undefined && patch.title !== beforeRow.title) changes.push('title')
    if (patch.description !== undefined) changes.push('description')
    if (patch.labels !== undefined) changes.push('labels')
    if (patch.estimateMin !== undefined && patch.estimateMin !== beforeRow.estimate_min) {
      changes.push('estimate')
    }
    if (patch.recurrence !== undefined) changes.push('recurrence')

    // A reassignment is its own event, not a shade of "updated": the new assignee needs "this is
    // yours now" in their inbox, which is a different sentence and a different urgency from the
    // watchers' "something moved" (SPEC §11's recipients rules).
    if (
      patch.assigneeUserId !== undefined &&
      patch.assigneeUserId !== null &&
      patch.assigneeUserId !== beforeRow.assignee_user_id
    ) {
      tx.emit({
        type: 'work.card.assigned',
        payload: {
          cardId,
          actorUserId: actorUserId,
          assigneeUserId: patch.assigneeUserId,
          previousAssigneeUserId: beforeRow.assignee_user_id,
        },
        departmentId,
      })
    }
    // Only when something other than the assignee moved. A pure reassignment is already told by the
    // event above (and telling the new assignee twice about one PATCH is exactly the kind of noise
    // that makes people mute an inbox); a pure reorder -- dragging a card up its own column -- is not
    // news for anybody, and on a busy board it is the most frequent write there is.
    const newsworthy = changes.filter((c) => c !== 'assignee')
    if (newsworthy.length > 0) {
      tx.emit({
        type: 'work.card.updated',
        payload: { cardId, actorUserId, changes: newsworthy },
        departmentId,
      })
    }

    const after = await tx.raw<CardRow>(sql`${cardSelect(ctx.userId)} where c.id = ${cardId}`)
    return { ok: true, card: toCardDTO(after[0]!) }
  })
}

export async function addChecklistItem(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  input: {
    text: string
    parentItemId?: string | null | undefined
    assigneeUserId?: string | null | undefined
    dueAt?: string | null | undefined
    orderKey?: string | undefined
  },
): Promise<string | null> {
  return withContext(ctx, async (tx) => {
    if (!(await cardIsVisible(tx, departmentId, cardId))) return null
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.card_checklist_items
            (id, department_id, card_id, parent_item_id, text, assignee_user_id, due_at, order_key)
          values (${id}, ${departmentId}, ${cardId}, ${input.parentItemId ?? null}, ${input.text},
            ${input.assigneeUserId ?? null}, ${input.dueAt ?? null}, ${input.orderKey ?? 'a0'})`,
    )
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, kind, data)
          values (${randomUUID()}, ${departmentId}, ${cardId}, 'checklist', ${JSON.stringify({ added: input.text })}::jsonb)`,
    )
    tx.audit({
      action: 'work.checklist_item_added',
      subjectType: 'card_checklist_item',
      subjectId: id,
      departmentId,
    })
    return id
  })
}

export async function patchChecklistItem(
  ctx: RequestContext,
  departmentId: string,
  itemId: string,
  patch: {
    text?: string | undefined
    done?: boolean | undefined
    assigneeUserId?: string | null | undefined
    dueAt?: string | null | undefined
    orderKey?: string | undefined
  },
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const sets: SQL[] = [sql`updated_at = now()`, sql`version = version + 1`]
    if (patch.text !== undefined) sets.push(sql`text = ${patch.text}`)
    if (patch.done !== undefined) sets.push(sql`done_at = ${patch.done ? sql`now()` : null}`)
    if (patch.assigneeUserId !== undefined)
      sets.push(sql`assignee_user_id = ${patch.assigneeUserId}`)
    if (patch.dueAt !== undefined) sets.push(sql`due_at = ${patch.dueAt}`)
    if (patch.orderKey !== undefined) sets.push(sql`order_key = ${patch.orderKey}`)
    const result = await tx.raw<{ card_id: string }>(
      sql`update app.card_checklist_items set ${sql.join(sets, sql`, `)}
          where id = ${itemId} and department_id = ${departmentId} and deleted_at is null
          returning card_id`,
    )
    return result.length > 0
  })
}

export async function deleteChecklistItem(
  ctx: RequestContext,
  departmentId: string,
  itemId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const result = await tx.raw<{ id: string }>(
      sql`update app.card_checklist_items set deleted_at = now(), updated_at = now()
          where id = ${itemId} and department_id = ${departmentId} and deleted_at is null
          returning id`,
    )
    return result.length > 0
  })
}

export async function addComment(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  authorUserId: string,
  text: string,
  mentions: string[],
): Promise<string | null> {
  return withContext(ctx, async (tx) => {
    if (!(await cardIsVisible(tx, departmentId, cardId))) return null
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.card_comments (id, department_id, card_id, author_user_id, body, mentions)
          values (${id}, ${departmentId}, ${cardId}, ${authorUserId},
            ${JSON.stringify({ format: 'markdown', text })}::jsonb, ${sql.param(mentions)}::uuid[])`,
    )
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values (${randomUUID()}, ${departmentId}, ${cardId}, ${authorUserId}, 'comment', '{}'::jsonb)`,
    )
    tx.audit({
      action: 'work.comment_added',
      subjectType: 'card_comment',
      subjectId: id,
      departmentId,
    })
    tx.emit({
      type: 'work.card.commented',
      payload: { cardId, commentId: id, mentions, actorUserId: authorUserId },
      departmentId,
    })
    return id
  })
}

export async function createLabel(
  ctx: RequestContext,
  departmentId: string,
  name: string,
  colour: string,
): Promise<{ id: string; name: string; colour: string }> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.labels (id, department_id, name, colour) values (${id}, ${departmentId}, ${name}, ${colour})`,
    )
    tx.audit({
      action: 'work.label_created',
      subjectType: 'label',
      subjectId: id,
      departmentId,
    })
    return { id, name, colour }
  })
}

export async function listSavedViews(
  ctx: RequestContext,
  departmentId: string,
  ownerUserId: string,
) {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      id: string
      name: string
      filter: string
      layout: 'people_board' | 'table' | 'timeline' | 'calendar' | 'mine'
      shared: boolean
      owner_user_id: string
    }>(
      sql`select id, name, filter, layout, shared, owner_user_id from app.saved_views
          where department_id = ${departmentId} and deleted_at is null
            and (shared = true or owner_user_id = ${ownerUserId})
          order by name asc`,
    )
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      filter: r.filter,
      layout: r.layout,
      shared: r.shared,
      ownerUserId: r.owner_user_id,
    }))
  })
}

export async function createSavedView(
  ctx: RequestContext,
  departmentId: string,
  ownerUserId: string,
  input: {
    name: string
    filter: string
    layout: SavedViewLayout
    shared?: boolean | undefined
  },
) {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await tx.raw(
      sql`insert into app.saved_views (id, department_id, owner_user_id, name, filter, layout, shared)
          values (${id}, ${departmentId}, ${ownerUserId}, ${input.name}, ${input.filter}, ${input.layout}, ${input.shared ?? false})`,
    )
    return {
      id,
      name: input.name,
      filter: input.filter,
      layout: input.layout,
      shared: input.shared ?? false,
      ownerUserId,
    }
  })
}

export async function deleteSavedView(
  ctx: RequestContext,
  departmentId: string,
  ownerUserId: string,
  id: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const result = await tx.raw<{ id: string }>(
      sql`update app.saved_views set deleted_at = now()
          where id = ${id} and department_id = ${departmentId} and owner_user_id = ${ownerUserId}
          returning id`,
    )
    return result.length > 0
  })
}

export async function listArchiveForMember(
  ctx: RequestContext,
  departmentId: string,
  memberUserId: string,
): Promise<CardDTO[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<CardRow>(
      sql`${cardSelect(ctx.userId)}
          where c.department_id = ${departmentId} and c.assignee_user_id = ${memberUserId}
            and c.status = 'archived' and c.deleted_at is null
          order by c.archived_at desc`,
    )
    return rows.map(toCardDTO)
  })
}

export async function restoreCard(
  ctx: RequestContext,
  departmentId: string,
  cardId: string,
  actorUserId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const result = await tx.raw<{ id: string }>(
      sql`update app.cards set status = 'active', archived_at = null, updated_at = now(), version = version + 1
          where id = ${cardId} and department_id = ${departmentId} and status = 'archived'
          returning id`,
    )
    if (result.length === 0) return false
    await tx.raw(
      sql`insert into app.card_activity (id, department_id, card_id, actor_user_id, kind, data)
          values (${randomUUID()}, ${departmentId}, ${cardId}, ${actorUserId}, 'status', ${JSON.stringify({ to: 'active', restored: true })}::jsonb)`,
    )
    tx.audit({
      action: 'work.card_restored',
      subjectType: 'card',
      subjectId: cardId,
      departmentId,
    })
    return true
  })
}

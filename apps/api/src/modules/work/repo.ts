// Postgres access for the work module, through `@devon/db`'s `withContext()`/`tx.raw()` directly
// (MODULE-GUIDE.md "API modules": never a direct import of another module's `Deps`, and a module's own
// `packages/db/src/schema/<name>.ts` is not reachable from `apps/api` at all -- `@devon/db`'s only
// export is `./src/index.ts`, and `schema/index.ts` never re-exports a module's tables). Every
// function opens its own `withContext()` transaction, exactly like `apps/api/src/db/repo.ts`.
import { randomUUID } from 'node:crypto'
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext } from '@devon/db'
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
  }
}

const CARD_SELECT = sql`
  select c.id, c.kind, c.title, c.description, c.assignee_user_id, c.giver_user_id, c.project_id,
    c.project_scope, c.status, c.priority, c.start_at, c.due_at, c.done_at, c.archived_at,
    c.order_key, c.labels, c.watchers, c.links, c.created_by_user_id, c.created_at, c.updated_at,
    c.version,
    coalesce(cl.total, 0) as checklist_total, coalesce(cl.done, 0) as checklist_done,
    coalesce(cm.cnt, 0) as comment_count
  from app.cards c
  left join lateral (
    select count(*) as total, count(*) filter (where done_at is not null) as done
    from app.card_checklist_items where card_id = c.id and deleted_at is null
  ) cl on true
  left join lateral (
    select count(*) as cnt from app.card_comments where card_id = c.id and deleted_at is null
  ) cm on true
`

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
    }>(
      sql`select u.id as user_id, u.given_name, u.family_name, u.title, u.avatar_key, m.role
          from app.memberships m
          join app.users u on u.id = m.user_id
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
      sql`${CARD_SELECT}
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
      sql`${CARD_SELECT}
          where c.department_id = ${departmentId} and c.id = ${cardId} and c.deleted_at is null`,
    )
    return rows[0] ? toCardDTO(rows[0]) : null
  })
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
            order_key, created_by_user_id
          ) values (
            ${id}, ${input.departmentId}, ${input.kind ?? 'task'}, ${input.title},
            ${description ? JSON.stringify(description) : null}::jsonb,
            ${input.assigneeUserId ?? null}, ${input.giverUserId ?? null},
            ${input.projectId ?? null}, ${input.projectScope ?? 'none'}, ${input.priority ?? 'none'},
            ${input.startAt ?? null}, ${input.dueAt ?? null},
            ${sql.param(input.labels ?? [])}::uuid[], ${JSON.stringify(input.links ?? [])}::jsonb,
            ${input.orderKey ?? 'a0'}, ${input.createdByUserId}
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
      after: { title: input.title, assigneeUserId: input.assigneeUserId ?? null },
    })
    tx.emit({
      type: 'work.card.created',
      payload: { cardId: id },
      departmentId: input.departmentId,
    })

    const rows = await tx.raw<CardRow>(sql`${CARD_SELECT} where c.id = ${id}`)
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
      sql`${CARD_SELECT} where c.department_id = ${departmentId} and c.id = ${cardId} and c.deleted_at is null`,
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
    if (patch.status !== undefined) {
      sets.push(sql`status = ${patch.status}`)
      sets.push(
        sql`done_at = ${patch.status === 'done' ? sql`now()` : patch.status === 'active' ? null : sql`done_at`}`,
      )
      sets.push(sql`archived_at = ${patch.status === 'archived' ? sql`now()` : null}`)
    }

    await tx.raw(sql`update app.cards set ${sql.join(sets, sql`, `)} where id = ${cardId}`)

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
    tx.emit({ type: 'work.card.updated', payload: { cardId }, departmentId })

    const after = await tx.raw<CardRow>(sql`${CARD_SELECT} where c.id = ${cardId}`)
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
) {
  return withContext(ctx, async (tx) => {
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
) {
  return withContext(ctx, async (tx) => {
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
      payload: { cardId, commentId: id, mentions },
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
    tx.audit({ action: 'work.label_created', subjectType: 'label', subjectId: id, departmentId })
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
  input: { name: string; filter: string; layout: SavedViewLayout; shared?: boolean | undefined },
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
      sql`${CARD_SELECT}
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
    tx.audit({ action: 'work.card_restored', subjectType: 'card', subjectId: cardId, departmentId })
    return true
  })
}

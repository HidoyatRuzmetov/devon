// Postgres access for the Telegram Mini App's own two purpose-built reads (v1.1 SPEC §9).
//
// Everything the Mini App can do with an existing endpoint, it does with that endpoint: the inbox is
// `/api/v1/notifications`, a card is `/api/v1/cards/:id`, an RSVP is `/api/v1/events/:id/rsvp`, the
// today list and the Pomodoro are `/api/v1/personal/*`. Duplicating those would duplicate their
// permission checks, their audit rows and their domain events, which is exactly the drift I-7 and I-5
// exist to prevent.
//
// Two things genuinely need their own query, because a phone on a mobile network must not download a
// 5000-card board to show seven cards:
//   * `boardPeek`  -- my column plus a per-person count summary, in two batched queries, never one
//                     per person (I-14 / TECH-SPEC §16 "no query in a loop").
//   * `setupChecklist` -- the head's "is Telegram actually wired up?" answer, one query.
// and one is genuinely optional: the person custom fields (SPEC §5) are owned by the `fields` module,
// which lands in a sibling worktree this package must not depend on -- so every read below is
// feature-detected against the live catalogue and degrades to `{ available: false }`, which the Mini
// App renders as a designed empty state rather than an error.
//
// Same convention as every other module repo here (`notifications/repo.ts`, `telegram/repo.ts`):
// parameterized `tx.raw()` through `withContext()`, never a direct schema import, never string-built
// SQL.
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'

// --- Board peek ------------------------------------------------------------------------------------

export type MiniCard = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  risk: 'none' | 'at_risk' | 'overdue'
  dueAt: string | null
  assigneeUserId: string | null
  giverUserId: string | null
  projectTitle: string | null
  checklistTotal: number
  checklistDone: number
  commentCount: number
  canEdit: boolean
  version: number
}

export type MiniPerson = {
  userId: string
  givenName: string
  familyName: string
  title: string | null
  unitName: string | null
  role: 'head' | 'member'
  openCards: number
  overdueCards: number
  doneLast7d: number
}

export type BoardPeek = {
  mine: MiniCard[]
  team: MiniPerson[]
  departmentOpenCards: number
  departmentOverdueCards: number
}

type CardRow = {
  id: string
  title: string
  status: 'active' | 'done' | 'archived'
  priority: MiniCard['priority']
  due_at: Date | null
  assignee_user_id: string | null
  giver_user_id: string | null
  created_by_user_id: string
  project_title: string | null
  checklist_total: number
  checklist_done: number
  comment_count: number
  version: number
}

/** Same rule as `work/repo.ts`'s `computeRisk`, kept identical on purpose: the Mini App must not
 * invent a second definition of "at risk" that disagrees with the board the same person sees on the
 * web (WALKTHROUGH-FINDINGS: two screens, two numbers, one truth). */
function riskOf(row: Pick<CardRow, 'status' | 'due_at'>): MiniCard['risk'] {
  if (row.status !== 'active' || !row.due_at) return 'none'
  const due = new Date(row.due_at).getTime()
  const now = Date.now()
  if (due < now) return 'overdue'
  if (due - now <= 2 * 24 * 60 * 60 * 1000) return 'at_risk'
  return 'none'
}

function toMiniCard(row: CardRow, viewerUserId: string, isHead: boolean): MiniCard {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    risk: riskOf(row),
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
    assigneeUserId: row.assignee_user_id,
    giverUserId: row.giver_user_id,
    projectTitle: row.project_title,
    checklistTotal: Number(row.checklist_total ?? 0),
    checklistDone: Number(row.checklist_done ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    // v1.1 SPEC §2.1 `{kind:'owned'}`: giver, assignee and creator, or the boshqarma boshligʻi. The
    // server answers this so the Mini App never guesses a permission (I-6).
    canEdit:
      isHead ||
      row.assignee_user_id === viewerUserId ||
      row.giver_user_id === viewerUserId ||
      row.created_by_user_id === viewerUserId,
    version: row.version,
  }
}

const MINI_CARD_SELECT = sql`
  select c.id, c.title, c.status, c.priority, c.due_at, c.assignee_user_id, c.giver_user_id,
         c.created_by_user_id, c.version, p.title as project_title,
         coalesce(cl.total, 0) as checklist_total, coalesce(cl.done, 0) as checklist_done,
         coalesce(cm.cnt, 0) as comment_count
  from app.cards c
  left join app.projects p on p.id = c.project_id and p.deleted_at is null
  left join lateral (
    select count(*) as total, count(*) filter (where done_at is not null) as done
    from app.card_checklist_items where card_id = c.id and deleted_at is null
  ) cl on true
  left join lateral (
    select count(*) as cnt from app.card_comments where card_id = c.id and deleted_at is null
  ) cm on true
`

/**
 * "My column, and how the team is doing" in two queries.
 *
 * `mine` is every live card assigned to the viewer (plus the ones they gave that are still open, so
 * a boshqarma boshligʻi who assigns work sees it come back), capped and ordered the way the phone
 * wants to read it: overdue first, then by due date, then by priority.
 *
 * `team` is one grouped aggregate over the whole department -- a single `group by` over
 * `app.memberships left join app.cards`, never one count per person.
 */
export async function boardPeek(
  ctx: RequestContext,
  departmentId: string,
  viewerUserId: string,
  isHead: boolean,
): Promise<BoardPeek> {
  return withContext(ctx, async (tx) => {
    const [cardRows, teamRows] = await Promise.all([
      tx.raw<CardRow>(sql`
        ${MINI_CARD_SELECT}
        where c.department_id = ${departmentId}
          and c.deleted_at is null
          and c.status <> 'archived'
          and (c.assignee_user_id = ${viewerUserId} or (c.giver_user_id = ${viewerUserId} and c.status = 'active'))
        order by
          (c.status = 'active' and c.due_at is not null and c.due_at < now()) desc,
          c.due_at asc nulls last,
          case c.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2
                          when 'low' then 3 else 4 end asc,
          c.order_key asc
        limit 60
      `),
      tx.raw<{
        user_id: string
        given_name: string
        family_name: string
        title: string | null
        unit_name: string | null
        role: 'head' | 'member'
        open_cards: number
        overdue_cards: number
        done_last_7d: number
      }>(sql`
        select u.id as user_id, u.given_name, u.family_name, u.title, m.role,
               un.name as unit_name,
               count(c.id) filter (where c.status = 'active')::int as open_cards,
               count(c.id) filter (where c.status = 'active' and c.due_at is not null and c.due_at < now())::int as overdue_cards,
               count(c.id) filter (where c.status = 'done' and c.done_at >= now() - interval '7 days')::int as done_last_7d
        from app.memberships m
        join app.users u on u.id = m.user_id and u.deleted_at is null
        left join app.unit_roles ur
          on ur.user_id = u.id and ur.department_id = m.department_id and ur.deleted_at is null
        left join app.units un on un.id = ur.unit_id and un.deleted_at is null
        left join app.cards c
          on c.assignee_user_id = u.id and c.department_id = m.department_id
             and c.deleted_at is null and c.status <> 'archived'
        where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null
        group by u.id, u.given_name, u.family_name, u.title, m.role, un.name
        order by (m.role = 'head') desc, u.given_name asc, u.family_name asc
      `),
    ])

    const team: MiniPerson[] = teamRows.map((r) => ({
      userId: r.user_id,
      givenName: r.given_name,
      familyName: r.family_name,
      title: r.title,
      unitName: r.unit_name,
      role: r.role,
      openCards: Number(r.open_cards ?? 0),
      overdueCards: Number(r.overdue_cards ?? 0),
      doneLast7d: Number(r.done_last_7d ?? 0),
    }))

    return {
      mine: cardRows.map((row) => toMiniCard(row, viewerUserId, isHead)),
      team,
      departmentOpenCards: team.reduce((sum, p) => sum + p.openCards, 0),
      departmentOverdueCards: team.reduce((sum, p) => sum + p.overdueCards, 0),
    }
  })
}

// --- The head's setup checklist --------------------------------------------------------------------

export type SetupCounts = {
  memberCount: number
  linkedMemberCount: number
  groupCount: number
}

/** One query, three counts. Feeds `GET /telegram/departments/:id/setup-checklist` (head-only) and the
 * Mini App's own "Sozlash" screen. `app.telegram_links` is a `global` table (see
 * `packages/db/src/tenancy.ts`), so the department scoping is the membership join, not RLS. */
export async function setupCounts(ctx: RequestContext, departmentId: string): Promise<SetupCounts> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<{
      member_count: number
      linked_member_count: number
      group_count: number
    }>(sql`
      select
        (select count(*)::int from app.memberships m
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null)
          as member_count,
        (select count(*)::int from app.memberships m
          join app.telegram_links tl on tl.user_id = m.user_id and tl.unlinked_at is null
          where m.department_id = ${departmentId} and m.status = 'active' and m.deleted_at is null)
          as linked_member_count,
        (select count(*)::int from app.telegram_groups g
          where g.department_id = ${departmentId} and g.disconnected_at is null)
          as group_count
    `)
    const row = rows[0]
    return {
      memberCount: Number(row?.member_count ?? 0),
      linkedMemberCount: Number(row?.linked_member_count ?? 0),
      groupCount: Number(row?.group_count ?? 0),
    }
  })
}

// --- Person custom fields (SPEC §5), feature-detected ----------------------------------------------

export type MiniFieldOption = { id: string; label: Record<string, string>; colorToken: string }

/** Mirrors `FieldValue` in `@devon/contracts`. A jsonb column can physically hold anything, so every
 * value read back is narrowed here rather than trusted -- an object or a nested array left over from
 * a future field type becomes `null` instead of escaping into a response the schema then rejects. */
export type MiniFieldValue = string | number | boolean | string[] | null

function narrowValue(raw: unknown): MiniFieldValue {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
  return null
}

export type MiniField = {
  defId: string
  key: string
  label: Record<string, string>
  description: Record<string, string> | null
  type: string
  options: MiniFieldOption[]
  required: boolean
  selfEditable: boolean
  value: MiniFieldValue
  requested: boolean
}

export type MiniFields = { available: false } | { available: true; items: MiniField[] }

/** The `fields` module ships its own migration in a sibling worktree. Until that merges, these
 * tables do not exist -- `to_regclass` answers that in one round trip without an exception, so the
 * Mini App can show "not enabled yet" instead of a 500. */
async function fieldsTablesPresent(tx: Tx): Promise<boolean> {
  const rows = await tx.raw<{ ok: boolean }>(sql`
    select (to_regclass('app.field_defs') is not null
            and to_regclass('app.field_values') is not null) as ok
  `)
  return rows[0]?.ok === true
}

/** The one-query version, for the bootstrap payload: "should the Mini App show a Maydonlar tab at
 * all?". Never throws -- a catalogue probe that fails is answered `false`, which hides a tab rather
 * than breaking sign-in. */
export async function fieldsAvailable(ctx: RequestContext): Promise<boolean> {
  try {
    return await withContext(ctx, (tx) => fieldsTablesPresent(tx))
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function localized(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(asRecord(value))) if (typeof v === 'string') out[k] = v
  return out
}

function readOptions(value: unknown): MiniFieldOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const o = asRecord(raw)
    const id = typeof o['id'] === 'string' ? o['id'] : null
    if (!id) return []
    const colorToken = typeof o['colorToken'] === 'string' ? o['colorToken'] : 'label-slate'
    return [{ id, label: localized(o['label']), colorToken }]
  })
}

/** `true` when the column exists on the table -- the `fields` module's exact column spelling for
 * `order` and `self_editable` is its own to choose (SPEC §5 names the concepts, not the DDL), so
 * every optional column below is probed rather than assumed. Two round trips at most, on a screen
 * that opens once. */
async function columnsOf(tx: Tx, table: string): Promise<Set<string>> {
  const rows = await tx.raw<{ column_name: string }>(sql`
    select column_name from information_schema.columns
    where table_schema = 'app' and table_name = ${table}
  `)
  return new Set(rows.map((r) => r.column_name))
}

/**
 * The viewer's own person fields, with their own values and whether the head has asked them to fill
 * one. Head-only definitions (`visible_to = 'head_only'`) are still *listed* here, because they are
 * this person's own values about themselves -- SPEC §4.2/§6: "a member sees and edits their own
 * person page and own field values"; what `visible_to` gates is whether *other* people's values ever
 * appear, and no list endpoint in this file ever returns another person's value.
 */
export async function listMyPersonFields(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
): Promise<MiniFields> {
  return withContext(ctx, async (tx) => {
    if (!(await fieldsTablesPresent(tx))) return { available: false }

    const membershipRows = await tx.raw<{ id: string }>(sql`
      select id from app.memberships
      where user_id = ${userId} and department_id = ${departmentId}
        and status = 'active' and deleted_at is null
    `)
    const membershipId = membershipRows[0]?.id
    if (!membershipId) return { available: true, items: [] }

    const defCols = await columnsOf(tx, 'field_defs')
    const archivedClause = defCols.has('archived_at') ? sql` and archived_at is null` : sql``
    const defs = await tx.raw<Record<string, unknown>>(sql`
      select * from app.field_defs
      where department_id = ${departmentId} and applies_to = 'person'${archivedClause}
    `)
    if (defs.length === 0) return { available: true, items: [] }

    const [values, requests] = await Promise.all([
      tx.raw<{ def_id: string; value: unknown }>(sql`
        select def_id, value from app.field_values
        where department_id = ${departmentId} and subject_type = 'person' and subject_id = ${membershipId}
      `),
      (await tx
        .raw<{ ok: boolean }>(sql`select (to_regclass('app.field_requests') is not null) as ok`)
        .then((r) => r[0]?.ok === true))
        ? tx.raw<{ def_id: string }>(sql`
            select def_id from app.field_requests
            where department_id = ${departmentId} and user_id = ${userId} and resolved_at is null
          `)
        : Promise.resolve([]),
    ])

    const valueByDef = new Map(values.map((v) => [v.def_id, v.value]))
    const requestedDefs = new Set(requests.map((r) => r.def_id))

    const items = defs
      .map((raw) => {
        const id = typeof raw['id'] === 'string' ? raw['id'] : ''
        const order = typeof raw['order'] === 'number' ? raw['order'] : Number(raw['order'] ?? 0)
        return {
          order: Number.isFinite(order) ? order : 0,
          field: {
            defId: id,
            key: typeof raw['key'] === 'string' ? raw['key'] : id,
            label: localized(raw['label']),
            description: raw['description'] ? localized(raw['description']) : null,
            type: typeof raw['type'] === 'string' ? raw['type'] : 'text',
            options: readOptions(raw['options']),
            required: raw['required'] === true,
            // Absent column means "the module did not model an opt-out": the SPEC default for a
            // person field is that the person may fill it, which is the whole point of notify-to-fill.
            selfEditable: raw['self_editable'] === undefined ? true : raw['self_editable'] === true,
            value: narrowValue(valueByDef.get(id)),
            requested: requestedDefs.has(id),
          } satisfies MiniField,
        }
      })
      .filter((entry) => entry.field.defId !== '' && entry.field.type !== 'derived')
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.field)

    return { available: true, items }
  })
}

export type SetFieldOutcome = 'ok' | 'unavailable' | 'not_found' | 'not_self_editable'

/**
 * The member fills in their own value (SPEC §5: "members fill it in their profile"). Writes the
 * value, resolves any open fill request, audits and emits -- all in one transaction (I-5,
 * MODULE-GUIDE.md "Domain events"), so the head's progress counter and the notification pipeline see
 * it the same way they would from the web.
 */
export async function setMyPersonField(
  ctx: RequestContext,
  departmentId: string,
  userId: string,
  defId: string,
  value: MiniFieldValue,
): Promise<SetFieldOutcome> {
  return withContext(ctx, async (tx) => {
    if (!(await fieldsTablesPresent(tx))) return 'unavailable'

    const membershipRows = await tx.raw<{ id: string }>(sql`
      select id from app.memberships
      where user_id = ${userId} and department_id = ${departmentId}
        and status = 'active' and deleted_at is null
    `)
    const membershipId = membershipRows[0]?.id
    if (!membershipId) return 'not_found'

    const defs = await tx.raw<Record<string, unknown>>(sql`
      select * from app.field_defs
      where id = ${defId} and department_id = ${departmentId} and applies_to = 'person'
    `)
    const def = defs[0]
    if (!def) return 'not_found'
    if (def['self_editable'] === false) return 'not_self_editable'

    const before = await tx.raw<{ value: unknown }>(sql`
      select value from app.field_values
      where department_id = ${departmentId} and def_id = ${defId}
        and subject_type = 'person' and subject_id = ${membershipId}
    `)

    await tx.raw(sql`
      insert into app.field_values
        (department_id, def_id, subject_type, subject_id, value, updated_by_user_id, updated_at)
      values (${departmentId}, ${defId}, 'person', ${membershipId}, ${JSON.stringify(value ?? null)}::jsonb,
              ${userId}, now())
      on conflict (def_id, subject_id) do update
        set value = excluded.value, updated_by_user_id = excluded.updated_by_user_id,
            updated_at = excluded.updated_at
    `)

    const requestsPresent = await tx.raw<{ ok: boolean }>(
      sql`select (to_regclass('app.field_requests') is not null) as ok`,
    )
    if (requestsPresent[0]?.ok === true) {
      await tx.raw(sql`
        update app.field_requests set resolved_at = now()
        where department_id = ${departmentId} and def_id = ${defId} and user_id = ${userId}
          and resolved_at is null
      `)
    }

    tx.audit({
      action: 'fields.value_set',
      subjectType: 'field_value',
      subjectId: `${defId}:${membershipId}`,
      departmentId,
      before: { value: before[0]?.value ?? null },
      after: { value: value ?? null },
    })
    tx.emit({
      type: 'fields.value.filled',
      payload: {
        defId,
        userId,
        membershipId,
        source: 'telegram_miniapp',
      },
      departmentId,
    })
    return 'ok'
  })
}

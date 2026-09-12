// SQL for the custom-fields module (v1.1 SPEC §5). Everything here is hand-written `Tx.raw()` against
// `app.field_defs` / `app.field_values` / `app.field_requests`, the same separation every other
// module's `repo.ts` keeps: no HTTP, no `can()`, no business rule -- those live in `service.ts`.
//
// Two standing rules this file obeys rather than works around:
//   * No query in a loop (I-14). Every list function takes the whole cohort and returns a map; the
//     "notify to fill" fan-out is a single `insert ... select` over the department's memberships.
//   * Row-level security is the boundary, not a filter this file adds. A member reading values gets
//     head-only rows removed *by Postgres* (`field_values_read`), so a bug here can only ever show
//     less than the caller is allowed, never more.
import { sql } from 'drizzle-orm'
import type { Tx } from '@devon/db'
import type { FieldAppliesTo, FieldDef, FieldOption, FieldValue } from '@devon/contracts'

export type DefRow = {
  id: string
  department_id: string
  applies_to: FieldAppliesTo
  key: string
  label: Record<string, string> | null
  description: Record<string, string> | null
  type: FieldDef['type']
  options: FieldOption[] | null
  required: boolean
  default_value: FieldValue
  show_in_table: boolean
  show_on_card_tile: boolean
  self_editable: boolean
  visible_to: 'everyone' | 'head_only'
  sort: number
  reminder_days: number
  archived_at: Date | string | null
}

const DEF_COLUMNS = sql`
  id, department_id, applies_to, key, label, description, type, options, required, default_value,
  show_in_table, show_on_card_tile, self_editable, visible_to, sort, reminder_days, archived_at
`

function iso(value: Date | string | null): string | null {
  if (value === null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function toDef(row: DefRow): FieldDef {
  return {
    id: row.id,
    departmentId: row.department_id,
    appliesTo: row.applies_to,
    key: row.key,
    label: row.label ?? {},
    description: row.description,
    type: row.type,
    options: [...(row.options ?? [])].sort((a, b) => a.order - b.order),
    required: row.required,
    defaultValue: row.default_value ?? null,
    showInTable: row.show_in_table,
    showOnCardTile: row.show_on_card_tile,
    selfEditable: row.self_editable,
    visibleTo: row.visible_to,
    order: row.sort,
    archivedAt: iso(row.archived_at),
  }
}

/** The extra column the DTO carries beyond `FieldDef` -- how often a reminder is due. */
export function reminderDaysOf(row: DefRow): number {
  return row.reminder_days
}

export async function listDefs(
  tx: Tx,
  departmentId: string,
  appliesTo: FieldAppliesTo | null,
  includeArchived: boolean,
): Promise<DefRow[]> {
  return tx.raw<DefRow>(sql`
    select ${DEF_COLUMNS} from app.field_defs
    where department_id = ${departmentId}
      and (${appliesTo}::text is null or applies_to = ${appliesTo})
      and (${includeArchived} or archived_at is null)
    order by applies_to, sort, key
  `)
}

export async function getDef(tx: Tx, departmentId: string, id: string): Promise<DefRow | null> {
  const rows = await tx.raw<DefRow>(sql`
    select ${DEF_COLUMNS} from app.field_defs
    where department_id = ${departmentId} and id = ${id}
  `)
  return rows[0] ?? null
}

export async function countLiveDefs(
  tx: Tx,
  departmentId: string,
  appliesTo: FieldAppliesTo,
): Promise<number> {
  const rows = await tx.raw<{ n: string }>(sql`
    select count(*)::text as n from app.field_defs
    where department_id = ${departmentId} and applies_to = ${appliesTo} and archived_at is null
  `)
  return Number(rows[0]?.n ?? 0)
}

export type InsertDef = {
  departmentId: string
  appliesTo: FieldAppliesTo
  key: string
  label: Record<string, string>
  description: Record<string, string> | null
  type: FieldDef['type']
  options: readonly FieldOption[]
  required: boolean
  defaultValue: FieldValue
  showInTable: boolean
  showOnCardTile: boolean
  selfEditable: boolean
  visibleTo: 'everyone' | 'head_only'
  sort: number
  reminderDays: number
  createdByUserId: string
}

export async function insertDef(tx: Tx, input: InsertDef): Promise<DefRow> {
  const rows = await tx.raw<DefRow>(sql`
    insert into app.field_defs (
      department_id, applies_to, key, label, description, type, options, required, default_value,
      show_in_table, show_on_card_tile, self_editable, visible_to, sort, reminder_days,
      created_by_user_id
    ) values (
      ${input.departmentId}, ${input.appliesTo}, ${input.key},
      ${JSON.stringify(input.label)}::jsonb,
      ${input.description === null ? null : JSON.stringify(input.description)}::jsonb,
      ${input.type}, ${JSON.stringify(input.options)}::jsonb, ${input.required},
      ${input.defaultValue === null ? null : JSON.stringify(input.defaultValue)}::jsonb,
      ${input.showInTable}, ${input.showOnCardTile}, ${input.selfEditable}, ${input.visibleTo},
      ${input.sort}, ${input.reminderDays}, ${input.createdByUserId}
    )
    returning ${DEF_COLUMNS}
  `)
  return rows[0]!
}

export type DefPatch = Partial<
  Omit<InsertDef, 'departmentId' | 'appliesTo' | 'key' | 'createdByUserId'>
>

export async function updateDef(
  tx: Tx,
  departmentId: string,
  id: string,
  patch: DefPatch,
): Promise<DefRow | null> {
  const rows = await tx.raw<DefRow>(sql`
    update app.field_defs set
      label = coalesce(${patch.label === undefined ? null : JSON.stringify(patch.label)}::jsonb, label),
      description = case when ${patch.description !== undefined} then
        ${patch.description == null ? null : JSON.stringify(patch.description)}::jsonb
        else description end,
      type = coalesce(${patch.type ?? null}, type),
      options = coalesce(${patch.options === undefined ? null : JSON.stringify(patch.options)}::jsonb, options),
      required = coalesce(${patch.required ?? null}, required),
      default_value = case when ${patch.defaultValue !== undefined} then
        ${patch.defaultValue == null ? null : JSON.stringify(patch.defaultValue)}::jsonb
        else default_value end,
      show_in_table = coalesce(${patch.showInTable ?? null}, show_in_table),
      show_on_card_tile = coalesce(${patch.showOnCardTile ?? null}, show_on_card_tile),
      self_editable = coalesce(${patch.selfEditable ?? null}, self_editable),
      visible_to = coalesce(${patch.visibleTo ?? null}, visible_to),
      sort = coalesce(${patch.sort ?? null}, sort),
      reminder_days = coalesce(${patch.reminderDays ?? null}, reminder_days),
      updated_at = now(),
      version = version + 1
    where department_id = ${departmentId} and id = ${id}
    returning ${DEF_COLUMNS}
  `)
  return rows[0] ?? null
}

/** Keeps `field_values.head_only` in step with the definition's visibility, in the same transaction as
 * the definition change -- the denormalisation `migrations/1000_fields.sql` documents. */
export async function syncValueVisibility(
  tx: Tx,
  departmentId: string,
  defId: string,
  headOnly: boolean,
): Promise<void> {
  await tx.raw(sql`
    update app.field_values set head_only = ${headOnly}
    where department_id = ${departmentId} and def_id = ${defId} and head_only <> ${headOnly}
  `)
}

export async function setArchived(
  tx: Tx,
  departmentId: string,
  id: string,
  archived: boolean,
): Promise<DefRow | null> {
  const rows = await tx.raw<DefRow>(sql`
    update app.field_defs
    set archived_at = ${archived ? sql`now()` : sql`null`}, updated_at = now(), version = version + 1
    where department_id = ${departmentId} and id = ${id}
    returning ${DEF_COLUMNS}
  `)
  return rows[0] ?? null
}

/** One statement for the whole new order -- never one update per row (I-14). */
export async function reorderDefs(
  tx: Tx,
  departmentId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  await tx.raw(sql`
    update app.field_defs as d
    set sort = o.ord, updated_at = now()
    from (select * from unnest(${sql.param([...ids])}::uuid[]) with ordinality as t(id, ord)) as o
    where d.id = o.id and d.department_id = ${departmentId}
  `)
}

// --- values ---------------------------------------------------------------------------------------

export type ValueRow = {
  def_id: string
  key: string
  subject_type: FieldAppliesTo
  subject_id: string
  subject_user_id: string | null
  value: FieldValue
  updated_by_user_id: string | null
  updated_at: Date | string | null
}

export function toValueDto(row: ValueRow) {
  return {
    defId: row.def_id,
    key: row.key,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectUserId: row.subject_user_id,
    value: row.value ?? null,
    updatedByUserId: row.updated_by_user_id,
    updatedAt: iso(row.updated_at),
  }
}

/** Every value for a cohort of subjects in one query. `subjectIds` empty means "the whole
 * department", which is what the people table and the manager's progress bar ask for. */
export async function listValues(
  tx: Tx,
  departmentId: string,
  subjectType: FieldAppliesTo,
  subjectIds: readonly string[],
): Promise<ValueRow[]> {
  const ids = sql.param([...subjectIds])
  return tx.raw<ValueRow>(sql`
    select v.def_id, d.key, v.subject_type, v.subject_id, v.subject_user_id, v.value,
           v.updated_by_user_id, v.updated_at
    from app.field_values v
    join app.field_defs d on d.id = v.def_id
    where v.department_id = ${departmentId}
      and v.subject_type = ${subjectType}
      and (${subjectIds.length === 0} or v.subject_id = any(${ids}::uuid[]))
    order by d.sort, d.key
  `)
}

export type UpsertValue = {
  departmentId: string
  defId: string
  subjectType: FieldAppliesTo
  subjectId: string
  subjectUserId: string | null
  headOnly: boolean
  value: FieldValue
  updatedByUserId: string
}

export async function upsertValue(tx: Tx, input: UpsertValue): Promise<Omit<ValueRow, 'key'>> {
  const rows = await tx.raw<Omit<ValueRow, 'key'>>(sql`
    insert into app.field_values (
      department_id, def_id, subject_type, subject_id, subject_user_id, head_only, value,
      updated_by_user_id, updated_at
    ) values (
      ${input.departmentId}, ${input.defId}, ${input.subjectType}, ${input.subjectId},
      ${input.subjectUserId}, ${input.headOnly},
      ${input.value === null ? null : JSON.stringify(input.value)}::jsonb,
      ${input.updatedByUserId}, now()
    )
    on conflict (def_id, subject_id) do update set
      value = excluded.value,
      head_only = excluded.head_only,
      subject_user_id = coalesce(excluded.subject_user_id, app.field_values.subject_user_id),
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = now()
    returning def_id, subject_type, subject_id, subject_user_id, value,
              updated_by_user_id, updated_at
  `)
  return rows[0]!
}

export async function previousValue(
  tx: Tx,
  departmentId: string,
  defId: string,
  subjectId: string,
): Promise<FieldValue> {
  const rows = await tx.raw<{ value: FieldValue }>(sql`
    select value from app.field_values
    where department_id = ${departmentId} and def_id = ${defId} and subject_id = ${subjectId}
  `)
  return rows[0]?.value ?? null
}

// --- memberships ------------------------------------------------------------------------------------

export type MemberRow = { membership_id: string; user_id: string; locale: string | null }

/** Active memberships of the department, with each person's own locale -- the Telegram message and the
 * inbox row are both rendered in it. One query, never one per person. */
export async function activeMembers(tx: Tx, departmentId: string): Promise<MemberRow[]> {
  return tx.raw<MemberRow>(sql`
    select m.id as membership_id, m.user_id, u.locale
    from app.memberships m
    join app.users u on u.id = m.user_id
    where m.department_id = ${departmentId}
      and m.status = 'active' and m.deleted_at is null and u.deleted_at is null
    order by m.joined_at
  `)
}

export async function membershipOf(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<string | null> {
  const rows = await tx.raw<{ id: string }>(sql`
    select id from app.memberships
    where department_id = ${departmentId} and user_id = ${userId}
      and status = 'active' and deleted_at is null
    limit 1
  `)
  return rows[0]?.id ?? null
}

/** membership id -> user id, for the whole cohort at once. */
export async function membershipUserMap(
  tx: Tx,
  departmentId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const rows = await tx.raw<{ id: string; user_id: string }>(sql`
    select id, user_id from app.memberships
    where department_id = ${departmentId}
      and user_id = any(${sql.param([...userIds])}::uuid[])
      and status = 'active' and deleted_at is null
  `)
  return new Map(rows.map((r) => [r.id, r.user_id]))
}

// --- fill requests ------------------------------------------------------------------------------------

export type ProgressRow = { filled: string; total: string; open_requests: string }

/**
 * Progress for one definition: how many active members have an answer, how many there are, and how
 * many are still being waited on. One statement, three counts -- the manager renders a bar per
 * definition and a per-definition query would be one round trip per row.
 */
export async function progressFor(
  tx: Tx,
  departmentId: string,
  defIds: readonly string[],
): Promise<Map<string, { filled: number; total: number; openRequests: number }>> {
  if (defIds.length === 0) return new Map()
  const rows = await tx.raw<{
    def_id: string
    filled: string
    total: string
    open_requests: string
  }>(sql`
    with members as (
      select m.id as membership_id, m.user_id
      from app.memberships m
      join app.users u on u.id = m.user_id
      where m.department_id = ${departmentId}
        and m.status = 'active' and m.deleted_at is null and u.deleted_at is null
    ),
    defs as (
      select id from app.field_defs
      where department_id = ${departmentId} and id = any(${sql.param([...defIds])}::uuid[])
    )
    select d.id as def_id,
           count(*) filter (
             where v.value is not null and v.value::text <> 'null' and v.value::text <> '""'
           )::text as filled,
           count(members.membership_id)::text as total,
           (
             select count(*) from app.field_requests r
             where r.def_id = d.id and r.resolved_at is null
           )::text as open_requests
    from defs d
    cross join members
    left join app.field_values v on v.def_id = d.id and v.subject_id = members.membership_id
    group by d.id
  `)
  return new Map(
    rows.map((r) => [
      r.def_id,
      { filled: Number(r.filled), total: Number(r.total), openRequests: Number(r.open_requests) },
    ]),
  )
}

/**
 * "Notify to fill": one row per active member who has no answer yet and no open request, in a single
 * `insert ... select`. Returns the user ids actually asked, so the caller can emit one domain event
 * per person without re-reading the table.
 */
export async function createRequests(
  tx: Tx,
  departmentId: string,
  defId: string,
  requestedByUserId: string,
): Promise<string[]> {
  const rows = await tx.raw<{ user_id: string }>(sql`
    insert into app.field_requests (department_id, def_id, user_id, requested_by_user_id)
    select ${departmentId}, ${defId}, m.user_id, ${requestedByUserId}
    from app.memberships m
    join app.users u on u.id = m.user_id
    left join app.field_values v on v.def_id = ${defId} and v.subject_id = m.id
    where m.department_id = ${departmentId}
      and m.status = 'active' and m.deleted_at is null and u.deleted_at is null
      and m.user_id <> ${requestedByUserId}
      and (v.value is null or v.value::text = 'null' or v.value::text = '""')
    on conflict (def_id, user_id) where resolved_at is null do nothing
    returning user_id
  `)
  return rows.map((r) => r.user_id)
}

/** The head's second ask, and the reminder job's: stamp `reminded_at` on every open request older
 * than `days`, and report who was nudged. */
export async function markReminded(
  tx: Tx,
  departmentId: string,
  defId: string | null,
  olderThanDays: number,
): Promise<string[]> {
  const rows = await tx.raw<{ user_id: string }>(sql`
    update app.field_requests
    set reminded_at = now()
    where department_id = ${departmentId}
      and (${defId}::uuid is null or def_id = ${defId})
      and resolved_at is null
      and coalesce(reminded_at, requested_at) < now() - make_interval(days => ${olderThanDays})
    returning user_id
  `)
  return rows.map((r) => r.user_id)
}

export async function resolveRequest(
  tx: Tx,
  departmentId: string,
  defId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.raw<{ id: string }>(sql`
    update app.field_requests set resolved_at = now()
    where department_id = ${departmentId} and def_id = ${defId} and user_id = ${userId}
      and resolved_at is null
    returning id
  `)
  return rows.length > 0
}

export type OpenRequestRow = { def_id: string; requested_at: Date | string }

export async function openRequestsFor(
  tx: Tx,
  departmentId: string,
  userId: string,
): Promise<Map<string, string>> {
  const rows = await tx.raw<OpenRequestRow>(sql`
    select def_id, requested_at from app.field_requests
    where department_id = ${departmentId} and user_id = ${userId} and resolved_at is null
  `)
  return new Map(rows.map((r) => [r.def_id, iso(r.requested_at) ?? '']))
}

/** Every department that has at least one open request older than its definition's own reminder
 * window -- the reminder sweep's worklist, one query for the whole instance. */
export async function departmentsNeedingReminders(
  tx: Tx,
): Promise<{ department_id: string; def_id: string; reminder_days: number }[]> {
  return tx.raw<{ department_id: string; def_id: string; reminder_days: number }>(sql`
    select r.department_id, r.def_id, d.reminder_days
    from app.field_requests r
    join app.field_defs d on d.id = r.def_id
    where r.resolved_at is null
      and d.archived_at is null
      and coalesce(r.reminded_at, r.requested_at)
          < now() - make_interval(days => d.reminder_days)
    group by r.department_id, r.def_id, d.reminder_days
  `)
}

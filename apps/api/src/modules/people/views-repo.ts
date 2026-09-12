// Saved views for the people table (v1.1 SPEC §4.3). Storage for `app.people_views`
// (migration `0201_people_views.sql`); the *shape* of a view is `PeopleViewConfig` in
// `@devon/contracts`, shared with the screen and the CSV export so all three agree.
//
// Ownership is enforced here rather than in RLS, deliberately: the policy has to let any head of the
// department write, because "make this the department default" must clear whichever view currently
// holds the flag and that row may belong to a different head. So this file is where "you may not
// rename another head's private view" lives, and it answers the same 404 a foreign id gets (H1.2) so
// the two cases are indistinguishable from outside.
import { sql, type SQL } from 'drizzle-orm'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import {
  normalizePeopleViewConfig,
  PEOPLE_VIEW_CAPS,
  type PeopleViewConfig,
} from '@devon/contracts'

export type PeopleViewRow = {
  id: string
  name: string
  config: PeopleViewConfig
  shared: boolean
  isDepartmentDefault: boolean
  ownerUserId: string
  createdAt: string
  updatedAt: string
  version: number
}

type RawRow = {
  id: string
  name: string
  config: unknown
  shared: boolean
  is_department_default: boolean
  owner_user_id: string
  created_at: Date | string
  updated_at: Date | string
  version: number
}

const COLUMNS: SQL = sql`id, name, config, shared, is_department_default, owner_user_id, created_at, updated_at, version`

function toRow(raw: RawRow): PeopleViewRow {
  return {
    id: raw.id,
    name: raw.name,
    config: normalizePeopleViewConfig(raw.config),
    shared: raw.shared,
    isDepartmentDefault: raw.is_department_default,
    ownerUserId: raw.owner_user_id,
    createdAt: new Date(raw.created_at).toISOString(),
    updatedAt: new Date(raw.updated_at).toISOString(),
    version: raw.version,
  }
}

/** Every view this head may open: their own, the ones other heads shared, and the department default
 * whoever owns it. RLS already narrows to exactly that set; the order is the tab strip's order. */
export async function listViews(
  ctx: RequestContext,
  departmentId: string,
): Promise<PeopleViewRow[]> {
  return withContext(ctx, async (tx) => {
    const rows = await tx.raw<RawRow>(sql`
      select ${COLUMNS}
      from app.people_views
      where department_id = ${departmentId} and deleted_at is null
      order by is_department_default desc, sort asc, created_at asc
    `)
    return rows.map(toRow)
  })
}

async function ownedCount(tx: Tx, departmentId: string, ownerUserId: string): Promise<number> {
  const rows = await tx.raw<{ n: string }>(sql`
    select count(*) as n
    from app.people_views
    where department_id = ${departmentId}
      and owner_user_id = ${ownerUserId}
      and deleted_at is null
  `)
  return Number(rows[0]?.n ?? 0)
}

export type CreateViewInput = {
  name: string
  config: PeopleViewConfig
  shared: boolean
  makeDepartmentDefault: boolean
}

export type ViewOutcome =
  | { ok: true; view: PeopleViewRow }
  | { ok: false; reason: 'not_found' | 'cap_reached' | 'conflict' }

export async function createView(
  ctx: RequestContext,
  departmentId: string,
  ownerUserId: string,
  input: CreateViewInput,
): Promise<ViewOutcome> {
  return withContext(ctx, async (tx) => {
    if ((await ownedCount(tx, departmentId, ownerUserId)) >= PEOPLE_VIEW_CAPS.maxViewsPerHead) {
      return { ok: false, reason: 'cap_reached' }
    }
    if (input.makeDepartmentDefault) await clearDepartmentDefault(tx, departmentId)

    const rows = await tx.raw<RawRow>(sql`
      insert into app.people_views
        (department_id, owner_user_id, name, config, shared, is_department_default, sort)
      values (
        ${departmentId}, ${ownerUserId}, ${input.name},
        ${JSON.stringify(input.config)}::jsonb, ${input.shared}, ${input.makeDepartmentDefault},
        coalesce((select max(sort) + 1 from app.people_views
                  where department_id = ${departmentId} and deleted_at is null), 0)
      )
      returning ${COLUMNS}
    `)
    const row = rows[0]!
    tx.audit({
      action: 'people.view.created',
      subjectType: 'people_view',
      subjectId: row.id,
      departmentId,
      after: { name: row.name, shared: row.shared, isDepartmentDefault: row.is_department_default },
    })
    tx.emit({
      type: 'people.view.created',
      departmentId,
      payload: { viewId: row.id, ownerUserId, name: row.name },
    })
    return { ok: true, view: toRow(row) }
  })
}

async function clearDepartmentDefault(tx: Tx, departmentId: string): Promise<void> {
  await tx.raw(sql`
    update app.people_views
    set is_department_default = false, updated_at = now(), version = version + 1
    where department_id = ${departmentId} and is_department_default and deleted_at is null
  `)
}

export type PatchViewInput = {
  name?: string | undefined
  config?: PeopleViewConfig | undefined
  shared?: boolean | undefined
  makeDepartmentDefault?: boolean | undefined
  version: number
}

export async function patchView(
  ctx: RequestContext,
  departmentId: string,
  actorUserId: string,
  id: string,
  input: PatchViewInput,
): Promise<ViewOutcome> {
  return withContext(ctx, async (tx) => {
    const existing = await tx.raw<RawRow>(sql`
      select ${COLUMNS} from app.people_views
      where department_id = ${departmentId} and id = ${id} and deleted_at is null
    `)
    const before = existing[0]
    if (!before) return { ok: false, reason: 'not_found' }
    // Another head's private view is not yours to rename. Same 404 a foreign id gets.
    if (before.owner_user_id !== actorUserId && !before.shared && !before.is_department_default) {
      return { ok: false, reason: 'not_found' }
    }
    if (before.version !== input.version) return { ok: false, reason: 'conflict' }

    if (input.makeDepartmentDefault === true) await clearDepartmentDefault(tx, departmentId)

    const parts: SQL[] = []
    if (input.name !== undefined) parts.push(sql`name = ${input.name}`)
    if (input.config !== undefined) parts.push(sql`config = ${JSON.stringify(input.config)}::jsonb`)
    if (input.shared !== undefined) parts.push(sql`shared = ${input.shared}`)
    if (input.makeDepartmentDefault !== undefined)
      parts.push(sql`is_department_default = ${input.makeDepartmentDefault}`)
    parts.push(sql`updated_at = now()`, sql`version = version + 1`)

    const rows = await tx.raw<RawRow>(sql`
      update app.people_views
      set ${sql.join(parts, sql`, `)}
      where department_id = ${departmentId} and id = ${id} and deleted_at is null
      returning ${COLUMNS}
    `)
    const row = rows[0]
    if (!row) return { ok: false, reason: 'not_found' }
    tx.audit({
      action: 'people.view.updated',
      subjectType: 'people_view',
      subjectId: row.id,
      departmentId,
      before: {
        name: before.name,
        shared: before.shared,
        isDepartmentDefault: before.is_department_default,
      },
      after: { name: row.name, shared: row.shared, isDepartmentDefault: row.is_department_default },
    })
    return { ok: true, view: toRow(row) }
  })
}

export async function deleteView(
  ctx: RequestContext,
  departmentId: string,
  actorUserId: string,
  id: string,
): Promise<{ ok: boolean }> {
  return withContext(ctx, async (tx) => {
    const existing = await tx.raw<RawRow>(sql`
      select ${COLUMNS} from app.people_views
      where department_id = ${departmentId} and id = ${id} and deleted_at is null
    `)
    const before = existing[0]
    if (!before) return { ok: false }
    if (before.owner_user_id !== actorUserId && !before.is_department_default) {
      return { ok: false }
    }
    await tx.raw(sql`
      update app.people_views
      set deleted_at = now(), is_department_default = false, version = version + 1
      where department_id = ${departmentId} and id = ${id} and deleted_at is null
    `)
    tx.audit({
      action: 'people.view.deleted',
      subjectType: 'people_view',
      subjectId: id,
      departmentId,
      before: { name: before.name },
    })
    return { ok: true }
  })
}

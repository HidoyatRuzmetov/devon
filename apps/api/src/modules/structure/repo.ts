// Business logic for `/departments/*` structure routes (MODULE-GUIDE.md "API modules": "never a
// direct `@devon/db` import from a route handler" -- `index.ts`'s handlers only ever call the
// functions below, this file is the one place that imports `@devon/db`). `@devon/db`'s own
// `package.json` "exports" map publishes only `src/index.ts` (no deep import of `schema/structure.js`
// is even possible from a different package), so every query here goes through `Tx.raw()` with
// hand-written, parameterised SQL against `app.units`/`app.unit_roles` -- the same tables
// `packages/db/src/schema/structure.ts` describes for Drizzle's benefit inside that package (its own
// seed module, and `test/tenancy.registry.test.ts`).
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withContext, type RequestContext, type Role, type Tx } from '@devon/db'
import { StructureError } from './errors.js'
import type {
  AssignUnitRoleBody,
  CreateUnitBody,
  ReorderUnitsBody,
  UpdateUnitBody,
} from './schemas.js'

export type ActorCtx = {
  requestId: string
  userId: string
  role: Role
  ip: string
  userAgent: string
}

function deptRequestContext(actor: ActorCtx, departmentId: string | null): RequestContext {
  return {
    requestId: actor.requestId,
    userId: actor.userId,
    actorRole: actor.role,
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: actor.ip,
    userAgent: actor.userAgent,
  }
}

function withDept<T>(
  actor: ActorCtx,
  departmentId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(deptRequestContext(actor, departmentId), fn)
}

// --- row shapes (raw SQL comes back snake_case; every function below maps to the camelCase DTOs
// `schemas.ts` describes before returning) --------------------------------------------------------

type UnitRow = {
  id: string
  parent_unit_id: string | null
  name: string
  colour: number | null
  sort: number
  path: string
  version: number
}

function toUnitDto(r: UnitRow) {
  return {
    id: r.id,
    parentUnitId: r.parent_unit_id,
    name: r.name,
    colour: r.colour,
    sort: r.sort,
    path: r.path,
    version: r.version,
  }
}

type DepartmentSettingsRow = { settings: unknown }

export type DepartmentSettings = {
  allowSelfAssign: boolean
  allowStructureEdit: boolean
}

/**
 * D1 (SEV1), fixed. `departments/repo.ts`'s `updateDepartmentSettings` persists the settings jsonb
 * with its TypeScript property names -- `{"allowStructureEdit": false, ...}` -- and this function used
 * to read `settings['allow_structure_edit']`. That key is never written under either name's
 * counterpart, so the lookup was always `undefined`, `undefined !== false` was always `true`, and a
 * head who switched "members may edit the structure" off watched the UI update, the value persist,
 * `GET /departments/:id` report it off -- while members kept creating and deleting bo'limlar.
 *
 * Reads the writer's camelCase key first and keeps the snake_case spelling as a fallback, so a
 * department whose settings were hand-edited under the old name still resolves.
 *
 * The default also changes: `allowStructureEdit` is now **off** when absent (v1.1 SPEC §2.2 -- the
 * CTO's finding overrides TECH-SPEC §2.3's default-on; recorded in TECH-SPEC §19). The org chart is
 * the department's constitution. `allowSelfAssign` stays on: putting yourself in your own bo'lim is
 * convenience, not governance.
 */
function readSettings(raw: unknown): DepartmentSettings {
  const settings = (raw ?? {}) as Record<string, unknown>
  const bool = (camel: string, snake: string, fallback: boolean): boolean => {
    const value = settings[camel] ?? settings[snake]
    return typeof value === 'boolean' ? value : fallback
  }
  return {
    allowSelfAssign: bool('allowSelfAssign', 'allow_self_assign', true),
    allowStructureEdit: bool('allowStructureEdit', 'allow_structure_edit', false),
  }
}

// --- bootstrap: which department(s) am I in? -------------------------------------------------------
// No per-request department context exists yet at this point (that is exactly what this answers), so
// this runs under the additive self-read policies `migrations/0200_structure.sql` documents at
// length, never under a chosen `departmentId` GUC.

export type MyDepartment = {
  departmentId: string
  name: string
  role: 'head' | 'member'
}

export async function myDepartments(actor: ActorCtx): Promise<MyDepartment[]> {
  return withContext(deptRequestContext(actor, null), async (tx) => {
    const rows = await tx.raw<{
      department_id: string
      name: string
      role: 'head' | 'member'
    }>(sql`
      select d.id as department_id, d.name, m.role
      from app.memberships m
      join app.departments d on d.id = m.department_id
      where m.user_id = ${actor.userId} and m.status = 'active' and d.deleted_at is null
      order by d.name
    `)
    return rows.map((r) => ({
      departmentId: r.department_id,
      name: r.name,
      role: r.role,
    }))
  })
}

// --- units -------------------------------------------------------------------------------------

export type UnitsOverview = {
  units: ReturnType<typeof toUnitDto>[]
  settings: DepartmentSettings
}

export async function getUnitsOverview(
  actor: ActorCtx,
  departmentId: string,
): Promise<UnitsOverview> {
  return withDept(actor, departmentId, async (tx) => {
    const deptRows = await tx.raw<DepartmentSettingsRow>(
      sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
    )
    if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')

    const unitRows = await tx.raw<UnitRow>(sql`
      select id, parent_unit_id, name, colour, sort, path, version
      from app.units
      where department_id = ${departmentId} and deleted_at is null
      order by parent_unit_id nulls first, sort, name
    `)
    return {
      units: unitRows.map(toUnitDto),
      settings: readSettings(deptRows[0].settings),
    }
  })
}

async function loadUnit(tx: Tx, departmentId: string, unitId: string): Promise<UnitRow> {
  const rows = await tx.raw<UnitRow>(sql`
    select id, parent_unit_id, name, colour, sort, path, version
    from app.units
    where id = ${unitId} and department_id = ${departmentId} and deleted_at is null
  `)
  if (!rows[0]) throw new StructureError('not_found', 'Unit not found')
  return rows[0]
}

/** `actor` may create/rename/reorder when they are the department head, or the department's
 * `allowStructureEdit` setting opens it up (default: **off**, v1.1 SPEC §2.2). Deleting or archiving
 * a bo'lim is head-only regardless -- that route declares `{kind:'department_managed'}` and never
 * reaches this function. */
function assertCanEditStructure(
  actorRoleInDept: 'head' | 'member',
  settings: DepartmentSettings,
): void {
  if (actorRoleInDept === 'head') return
  if (!settings.allowStructureEdit) {
    throw new StructureError(
      'forbidden',
      'Structure editing is disabled for members in this department',
    )
  }
}

export async function createUnit(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  body: CreateUnitBody,
) {
  return withDept(actor, departmentId, async (tx) => {
    const deptRows = await tx.raw<DepartmentSettingsRow>(
      sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
    )
    if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')
    assertCanEditStructure(actorRoleInDept, readSettings(deptRows[0].settings))

    const parentUnitId = body.parentUnitId ?? null
    let parentPath = '/'
    if (parentUnitId) {
      const parent = await loadUnit(tx, departmentId, parentUnitId)
      parentPath = parent.path
    }

    const siblingRows = await tx.raw<{ max_sort: number | null }>(sql`
      select max(sort) as max_sort from app.units
      where department_id = ${departmentId} and deleted_at is null
        and parent_unit_id is not distinct from ${parentUnitId}
    `)
    const sort = (siblingRows[0]?.max_sort ?? -1) + 1

    const id = randomUUID()
    const path = `${parentPath}${id}/`

    const inserted = await tx.raw<UnitRow>(sql`
      insert into app.units (id, department_id, parent_unit_id, name, colour, sort, path, created_by)
      values (${id}, ${departmentId}, ${parentUnitId}, ${body.name}, ${body.colour ?? null}, ${sort}, ${path}, ${actor.userId})
      returning id, parent_unit_id, name, colour, sort, path, version
    `)
    const unit = inserted[0]!

    tx.audit({
      action: 'structure.unit_created',
      subjectType: 'unit',
      subjectId: unit.id,
      departmentId,
      after: { name: unit.name, parentUnitId: unit.parent_unit_id },
    })
    tx.emit({
      type: 'structure.unit.created',
      departmentId,
      payload: {
        unitId: unit.id,
        name: unit.name,
        parentUnitId: unit.parent_unit_id,
      },
    })

    return toUnitDto(unit)
  })
}

export async function updateUnit(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  unitId: string,
  body: UpdateUnitBody,
) {
  return withDept(actor, departmentId, async (tx) => {
    const deptRows = await tx.raw<DepartmentSettingsRow>(
      sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
    )
    if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')
    assertCanEditStructure(actorRoleInDept, readSettings(deptRows[0].settings))

    const before = await loadUnit(tx, departmentId, unitId)
    if (body.version !== undefined && body.version !== before.version) {
      throw new StructureError('conflict', 'This unit changed since you last loaded it')
    }

    const name = body.name ?? before.name
    const colour = body.colour === undefined ? before.colour : body.colour
    const reparenting =
      body.parentUnitId !== undefined && body.parentUnitId !== before.parent_unit_id

    let unit: UnitRow
    if (!reparenting) {
      // The common case (rename/recolour only): touches exactly this row, never a descendant.
      const updated = await tx.raw<UnitRow>(sql`
        update app.units
        set name = ${name}, colour = ${colour}, version = version + 1, updated_at = now()
        where id = ${unitId} and department_id = ${departmentId} and deleted_at is null
        returning id, parent_unit_id, name, colour, sort, path, version
      `)
      unit = updated[0]!
    } else {
      const newParentId = body.parentUnitId
      let newParentPath = '/'
      if (newParentId) {
        if (newParentId === unitId) {
          throw new StructureError('conflict', 'A unit cannot become its own parent')
        }
        const newParent = await loadUnit(tx, departmentId, newParentId)
        if (newParent.path.startsWith(before.path)) {
          throw new StructureError(
            'conflict',
            'A unit cannot move under one of its own descendants',
          )
        }
        newParentPath = newParent.path
      }
      const newOwnPath = `${newParentPath}${unitId}/`

      const siblingRows = await tx.raw<{ max_sort: number | null }>(sql`
        select max(sort) as max_sort from app.units
        where department_id = ${departmentId} and deleted_at is null
          and parent_unit_id is not distinct from ${newParentId}
      `)
      const newSort = (siblingRows[0]?.max_sort ?? -1) + 1

      // One statement covers the moved unit (name/colour/parent/sort/path all change) and every
      // descendant (path prefix rewritten, everything else untouched) -- `case when id = ` picks
      // which row gets which branch; Postgres computes every branch against the *old* row values
      // regardless of statement order, so this is not a per-row loop and not a staleness risk.
      const updated = await tx.raw<UnitRow>(sql`
        update app.units
        set name = case when id = ${unitId} then ${name} else name end,
            colour = case when id = ${unitId} then ${colour} else colour end,
            parent_unit_id = case when id = ${unitId} then ${newParentId} else parent_unit_id end,
            sort = case when id = ${unitId} then ${newSort} else sort end,
            path = ${newOwnPath} || substring(path from ${before.path.length + 1}),
            version = case when id = ${unitId} then version + 1 else version end,
            updated_at = now()
        where department_id = ${departmentId} and deleted_at is null
          and (id = ${unitId} or path like ${before.path + '%'})
        returning id, parent_unit_id, name, colour, sort, path, version
      `)
      unit = updated.find((r) => r.id === unitId)!
    }

    tx.audit({
      action: 'structure.unit_updated',
      subjectType: 'unit',
      subjectId: unitId,
      departmentId,
      before: { name: before.name, parentUnitId: before.parent_unit_id },
      after: { name: unit.name, parentUnitId: unit.parent_unit_id },
    })
    tx.emit({
      type: 'structure.unit.updated',
      departmentId,
      payload: { unitId, name: unit.name },
    })

    return toUnitDto(unit)
  })
}

export async function reorderUnits(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  body: ReorderUnitsBody,
) {
  return withDept(actor, departmentId, async (tx) => {
    const deptRows = await tx.raw<DepartmentSettingsRow>(
      sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
    )
    if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')
    assertCanEditStructure(actorRoleInDept, readSettings(deptRows[0].settings))

    const values = sql.join(
      body.orderedUnitIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
      sql`, `,
    )

    await tx.raw(sql`
      update app.units as u
      set sort = v.sort, updated_at = now()
      from (values ${values}) as v(id, sort)
      where u.id = v.id and u.department_id = ${departmentId} and u.deleted_at is null
        and u.parent_unit_id is not distinct from ${body.parentUnitId}
    `)

    tx.audit({
      action: 'structure.units_reordered',
      subjectType: 'unit',
      subjectId: body.parentUnitId,
      departmentId,
      after: { orderedUnitIds: body.orderedUnitIds },
    })
    tx.emit({
      type: 'structure.unit.reordered',
      departmentId,
      payload: {
        parentUnitId: body.parentUnitId,
        orderedUnitIds: body.orderedUnitIds,
      },
    })
  })
}

export async function deleteUnit(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  unitId: string,
): Promise<{ deletedAt: string }> {
  return withDept(actor, departmentId, async (tx) => {
    const deptRows = await tx.raw<DepartmentSettingsRow>(
      sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
    )
    if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')
    assertCanEditStructure(actorRoleInDept, readSettings(deptRows[0].settings))

    const unit = await loadUnit(tx, departmentId, unitId)
    const deletedAt = new Date()
    const prefix = `${unit.path}%`

    await tx.raw(sql`
      update app.units
      set deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      where department_id = ${departmentId} and deleted_at is null
        and (id = ${unitId} or path like ${prefix})
    `)
    await tx.raw(sql`
      update app.unit_roles
      set deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      where department_id = ${departmentId} and deleted_at is null
        and unit_id in (
          select id from app.units
          where department_id = ${departmentId} and (id = ${unitId} or path like ${prefix})
        )
    `)

    tx.audit({
      action: 'structure.unit_deleted',
      subjectType: 'unit',
      subjectId: unitId,
      departmentId,
      before: { name: unit.name },
    })
    tx.emit({
      type: 'structure.unit.deleted',
      departmentId,
      payload: { unitId },
    })

    return { deletedAt: deletedAt.toISOString() }
  })
}

export async function restoreUnit(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  unitId: string,
  deletedAt: string,
) {
  return withDept(actor, departmentId, async (tx) => {
    const deptRows = await tx.raw<DepartmentSettingsRow>(
      sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
    )
    if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')
    assertCanEditStructure(actorRoleInDept, readSettings(deptRows[0].settings))

    const ts = new Date(deletedAt)
    const rows = await tx.raw<UnitRow>(sql`
      select id, parent_unit_id, name, colour, sort, path, version
      from app.units
      where id = ${unitId} and department_id = ${departmentId} and deleted_at = ${ts}
    `)
    if (!rows[0])
      throw new StructureError('not_found', 'Nothing to restore (already gone, or too late)')
    const prefix = `${rows[0].path}%`

    await tx.raw(sql`
      update app.units
      set deleted_at = null, updated_at = now(), version = version + 1
      where department_id = ${departmentId} and deleted_at = ${ts}
        and (id = ${unitId} or path like ${prefix})
    `)
    await tx.raw(sql`
      update app.unit_roles
      set deleted_at = null, updated_at = now(), version = version + 1
      where department_id = ${departmentId} and deleted_at = ${ts}
        and unit_id in (
          select id from app.units
          where department_id = ${departmentId} and (id = ${unitId} or path like ${prefix})
        )
    `)

    tx.audit({
      action: 'structure.unit_restored',
      subjectType: 'unit',
      subjectId: unitId,
      departmentId,
      after: { name: rows[0].name },
    })
    tx.emit({
      type: 'structure.unit.restored',
      departmentId,
      payload: { unitId },
    })

    return toUnitDto({ ...rows[0], version: rows[0].version + 1 })
  })
}

// --- unit roles ----------------------------------------------------------------------------------

type UnitRoleRow = {
  id: string
  unit_id: string
  user_id: string
  role: 'head' | 'deputy' | 'member'
  assigned_by: string
  // `tx.raw()` is a plain, un-schema'd SQL query (unlike `tx.drizzle`'s typed builder), so none of
  // drizzle's own column-level date mapping runs on it -- the node-postgres driver as drizzle
  // configures it (`node-postgres/session.ts`) hands back TIMESTAMPTZ/TIMESTAMP/DATE columns as raw
  // strings on that path, never a `Date` (H1: this was `r.assigned_at.toISOString is not a function`
  // in production, not a type-only mismatch), so this is typed to match reality.
  assigned_at: Date | string
}

function toUnitRoleDto(r: UnitRoleRow) {
  return {
    id: r.id,
    unitId: r.unit_id,
    userId: r.user_id,
    role: r.role,
    assignedBy: r.assigned_by,
    assignedAt: new Date(r.assigned_at).toISOString(),
  }
}

export async function listUnitRoles(actor: ActorCtx, departmentId: string) {
  return withDept(actor, departmentId, async (tx) => {
    const rows = await tx.raw<UnitRoleRow>(sql`
      select id, unit_id, user_id, role, assigned_by, assigned_at
      from app.unit_roles
      where department_id = ${departmentId} and deleted_at is null
      order by assigned_at
    `)
    return rows.map(toUnitRoleDto)
  })
}

export async function assignUnitRole(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  body: AssignUnitRoleBody,
) {
  return withDept(actor, departmentId, async (tx) => {
    const isSelf = body.userId === actor.userId
    if (!isSelf && actorRoleInDept !== 'head') {
      throw new StructureError('forbidden', 'Only the department head can assign someone else')
    }
    if (isSelf && actorRoleInDept !== 'head') {
      const deptRows = await tx.raw<DepartmentSettingsRow>(
        sql`select settings from app.departments where id = ${departmentId} and deleted_at is null`,
      )
      if (!deptRows[0]) throw new StructureError('not_found', 'Department not found')
      if (!readSettings(deptRows[0].settings).allowSelfAssign) {
        throw new StructureError('forbidden', 'Self-assignment is disabled in this department')
      }
    }

    await loadUnit(tx, departmentId, body.unitId)

    const memberRows = await tx.raw<{ user_id: string }>(sql`
      select user_id from app.memberships
      where department_id = ${departmentId} and user_id = ${body.userId} and status = 'active'
    `)
    if (!memberRows[0])
      throw new StructureError('not_found', 'That person is not a member of this department')

    const upserted = await tx.raw<UnitRoleRow>(sql`
      insert into app.unit_roles (id, department_id, unit_id, user_id, role, assigned_by, assigned_at)
      values (${randomUUID()}, ${departmentId}, ${body.unitId}, ${body.userId}, ${body.role}, ${actor.userId}, now())
      on conflict (department_id, user_id) where deleted_at is null
      do update set unit_id = excluded.unit_id, role = excluded.role, assigned_by = excluded.assigned_by,
        assigned_at = excluded.assigned_at, updated_at = now(), version = app.unit_roles.version + 1
      returning id, unit_id, user_id, role, assigned_by, assigned_at
    `)
    const row = upserted[0]!

    tx.audit({
      action: 'structure.unit_role_assigned',
      subjectType: 'unit_role',
      subjectId: row.id,
      departmentId,
      after: { unitId: row.unit_id, userId: row.user_id, role: row.role },
    })
    tx.emit({
      type: 'structure.unit_role.assigned',
      departmentId,
      payload: {
        unitId: row.unit_id,
        userId: row.user_id,
        role: row.role,
        actorUserId: actor.userId,
      },
    })

    return toUnitRoleDto(row)
  })
}

export async function unassignUnitRole(
  actor: ActorCtx,
  departmentId: string,
  actorRoleInDept: 'head' | 'member',
  unitRoleId: string,
) {
  return withDept(actor, departmentId, async (tx) => {
    const rows = await tx.raw<UnitRoleRow>(sql`
      select id, unit_id, user_id, role, assigned_by, assigned_at
      from app.unit_roles
      where id = ${unitRoleId} and department_id = ${departmentId} and deleted_at is null
    `)
    const row = rows[0]
    if (!row) throw new StructureError('not_found', 'Assignment not found')
    if (row.user_id !== actor.userId && actorRoleInDept !== 'head') {
      throw new StructureError('forbidden', 'Only the department head can remove someone else')
    }

    await tx.raw(sql`
      update app.unit_roles set deleted_at = now(), updated_at = now() where id = ${unitRoleId}
    `)

    tx.audit({
      action: 'structure.unit_role_unassigned',
      subjectType: 'unit_role',
      subjectId: unitRoleId,
      departmentId,
      before: { unitId: row.unit_id, userId: row.user_id, role: row.role },
    })
    tx.emit({
      type: 'structure.unit_role.unassigned',
      departmentId,
      payload: { unitId: row.unit_id, userId: row.user_id },
    })
  })
}

// --- members (People page) ------------------------------------------------------------------------

type MemberRow = {
  user_id: string
  given_name: string
  family_name: string
  patronymic: string | null
  title: string | null
  avatar_key: string | null
  membership_role: 'head' | 'member'
  unit_id: string | null
  unit_role: 'head' | 'deputy' | 'member' | null
}

export async function listMembers(actor: ActorCtx, departmentId: string) {
  return withDept(actor, departmentId, async (tx) => {
    const rows = await tx.raw<MemberRow>(sql`
      select
        u.id as user_id, u.given_name, u.family_name, u.patronymic, u.title, u.avatar_key,
        m.role as membership_role, ur.unit_id, ur.role as unit_role
      from app.memberships m
      join app.users u on u.id = m.user_id and u.deleted_at is null
      left join app.unit_roles ur
        on ur.department_id = m.department_id and ur.user_id = m.user_id and ur.deleted_at is null
      where m.department_id = ${departmentId} and m.status = 'active'
      order by u.family_name, u.given_name
    `)
    return rows.map((r) => ({
      userId: r.user_id,
      givenName: r.given_name,
      familyName: r.family_name,
      patronymic: r.patronymic,
      title: r.title,
      avatarKey: r.avatar_key,
      membershipRole: r.membership_role,
      unitId: r.unit_id,
      unitRole: r.unit_role,
    }))
  })
}

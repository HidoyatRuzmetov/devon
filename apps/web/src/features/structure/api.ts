// Typed endpoint functions for `/departments/*` (MODULE-GUIDE.md "Web features"), built on
// `apiClient` exactly like `src/lib/api-client.ts`'s own header documents. These are this feature's
// own copy of `apps/api/src/modules/structure/schemas.ts`'s shapes -- the same "no shared DTO
// package" tradeoff `apps/web/src/lib/api-schemas.ts` already documents for `/me`/`/instance`.
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'

export const membershipRoleSchema = z.enum(['head', 'member'])
export const unitRoleKindSchema = z.enum(['head', 'deputy', 'member'])

export const myDepartmentSchema = z.object({
  departmentId: z.string(),
  name: z.string(),
  role: membershipRoleSchema,
})
export type MyDepartment = z.infer<typeof myDepartmentSchema>

export const unitSchema = z.object({
  id: z.string(),
  parentUnitId: z.string().nullable(),
  name: z.string(),
  colour: z.number().nullable(),
  sort: z.number(),
  path: z.string(),
  version: z.number(),
})
export type Unit = z.infer<typeof unitSchema>

export const unitsOverviewSchema = z.object({
  units: z.array(unitSchema),
  settings: z.object({ allowSelfAssign: z.boolean(), allowStructureEdit: z.boolean() }),
  myRole: membershipRoleSchema,
})
export type UnitsOverview = z.infer<typeof unitsOverviewSchema>

export const unitRoleSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  userId: z.string(),
  role: unitRoleKindSchema,
  assignedBy: z.string(),
  assignedAt: z.string(),
})
export type UnitRole = z.infer<typeof unitRoleSchema>

export const memberSchema = z.object({
  userId: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  membershipRole: membershipRoleSchema,
  unitId: z.string().nullable(),
  unitRole: unitRoleKindSchema.nullable(),
})
export type Member = z.infer<typeof memberSchema>

// Named aliases (not raw `Map<string, X>` literals) so `.tsx` files can declare these fields without
// putting a generic's `<`/`>` next to another one on an adjacent line -- `check-i18n.mjs`'s hard-coded
// JSX text heuristic reads literal `>...<` runs and cannot tell that gap apart from real element text.
export type RolesByUnit = Map<string, UnitRole[]>
export type MembersById = Map<string, Member>

const deletedUnitSchema = z.object({ deletedAt: z.string() })

export function fetchUnitsOverview(departmentId: string): Promise<UnitsOverview> {
  return apiClient.get(`/api/v1/departments/${departmentId}/units`, unitsOverviewSchema)
}

export function createUnit(
  departmentId: string,
  body: { name: string; colour?: number | null; parentUnitId?: string | null },
  csrfToken: string,
): Promise<Unit> {
  return apiClient.post(`/api/v1/departments/${departmentId}/units`, body, unitSchema, csrfToken)
}

export function updateUnit(
  departmentId: string,
  unitId: string,
  body: { name?: string; colour?: number | null; parentUnitId?: string | null; version?: number },
  csrfToken: string,
): Promise<Unit> {
  return apiClient.patch(
    `/api/v1/departments/${departmentId}/units/${unitId}`,
    body,
    unitSchema,
    csrfToken,
  )
}

export function reorderUnits(
  departmentId: string,
  body: { parentUnitId: string | null; orderedUnitIds: string[] },
  csrfToken: string,
): Promise<void> {
  return apiClient.post(
    `/api/v1/departments/${departmentId}/units/reorder`,
    body,
    z.void(),
    csrfToken,
  )
}

export function deleteUnit(
  departmentId: string,
  unitId: string,
  csrfToken: string,
): Promise<{ deletedAt: string }> {
  return apiClient.delete(
    `/api/v1/departments/${departmentId}/units/${unitId}`,
    deletedUnitSchema,
    csrfToken,
  )
}

export function restoreUnit(
  departmentId: string,
  unitId: string,
  deletedAt: string,
  csrfToken: string,
): Promise<Unit> {
  return apiClient.post(
    `/api/v1/departments/${departmentId}/units/${unitId}/restore`,
    { deletedAt },
    unitSchema,
    csrfToken,
  )
}

export function fetchUnitRoles(departmentId: string): Promise<UnitRole[]> {
  return apiClient.get(`/api/v1/departments/${departmentId}/unit-roles`, z.array(unitRoleSchema))
}

export function assignUnitRole(
  departmentId: string,
  body: { unitId: string; userId: string; role: 'head' | 'deputy' | 'member' },
  csrfToken: string,
): Promise<UnitRole> {
  return apiClient.post(
    `/api/v1/departments/${departmentId}/unit-roles`,
    body,
    unitRoleSchema,
    csrfToken,
  )
}

export function unassignUnitRole(
  departmentId: string,
  unitRoleId: string,
  csrfToken: string,
): Promise<void> {
  return apiClient.delete(
    `/api/v1/departments/${departmentId}/unit-roles/${unitRoleId}`,
    z.void(),
    csrfToken,
  )
}

// `/roster`, not `/members`: the `departments` feature's own `/api/v1/departments/:id/members`
// (membership administration) collides on path with what used to be this module's identical-looking
// route -- this one is the org-chart roster (unit assignment), a different shape, so it moved to its
// own path when the two modules were integrated together.
export function fetchMembers(departmentId: string): Promise<Member[]> {
  return apiClient.get(`/api/v1/departments/${departmentId}/roster`, z.array(memberSchema))
}

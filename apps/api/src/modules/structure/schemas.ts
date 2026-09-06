// Zod schemas for `/departments/*` structure endpoints (MODULE-GUIDE.md "API modules": validate every
// body/params/query, never trust `req.body` raw). Response schemas double as the OpenAPI document
// (`fastify-type-provider-zod`'s `jsonSchemaTransform`, wired once in `src/app.ts`).
import { z } from 'zod'

export const uuidSchema = z.string().uuid()

/** `@devon/ui`'s 8 categorical unit hues (`packages/ui/src/styles/tokens.css`). `null`/omitted means
 * "auto" -- the client derives a stable hue from the unit's own id (tokens only, never a raw colour;
 * CLAUDE.md). */
export const unitColourSchema = z.number().int().min(1).max(8).nullable()

export const unitRoleKindSchema = z.enum(['head', 'deputy', 'member'])
export const membershipRoleSchema = z.enum(['head', 'member'])

export const departmentsMineSchema = z.array(
  z.object({
    departmentId: uuidSchema,
    name: z.string(),
    role: membershipRoleSchema,
  }),
)
export type DepartmentsMine = z.infer<typeof departmentsMineSchema>

export const unitSchema = z.object({
  id: uuidSchema,
  parentUnitId: uuidSchema.nullable(),
  name: z.string(),
  colour: unitColourSchema,
  sort: z.number().int(),
  path: z.string(),
  version: z.number().int(),
})
export type UnitDto = z.infer<typeof unitSchema>

export const unitsOverviewSchema = z.object({
  units: z.array(unitSchema),
  settings: z.object({
    allowSelfAssign: z.boolean(),
    allowStructureEdit: z.boolean(),
  }),
  myRole: membershipRoleSchema,
})
export type UnitsOverview = z.infer<typeof unitsOverviewSchema>

export const unitParamsSchema = z.object({
  departmentId: uuidSchema,
  unitId: uuidSchema,
})
export const departmentParamsSchema = z.object({ departmentId: uuidSchema })

export const createUnitBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    colour: unitColourSchema.optional(),
    parentUnitId: uuidSchema.nullable().optional(),
  })
  .strict()
export type CreateUnitBody = z.infer<typeof createUnitBodySchema>

export const updateUnitBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    colour: unitColourSchema.optional(),
    parentUnitId: uuidSchema.nullable().optional(),
    version: z.number().int().optional(),
  })
  .strict()
export type UpdateUnitBody = z.infer<typeof updateUnitBodySchema>

export const deletedUnitSchema = z.object({ deletedAt: z.string() })

export const restoreUnitBodySchema = z.object({ deletedAt: z.string() }).strict()

export const reorderUnitsBodySchema = z
  .object({
    parentUnitId: uuidSchema.nullable(),
    orderedUnitIds: z.array(uuidSchema).min(1).max(200),
  })
  .strict()
export type ReorderUnitsBody = z.infer<typeof reorderUnitsBodySchema>

export const unitRoleSchema = z.object({
  id: uuidSchema,
  unitId: uuidSchema,
  userId: uuidSchema,
  role: unitRoleKindSchema,
  assignedBy: uuidSchema,
  assignedAt: z.string(),
})
export type UnitRoleDto = z.infer<typeof unitRoleSchema>

export const unitRolesListSchema = z.array(unitRoleSchema)

export const assignUnitRoleBodySchema = z
  .object({
    unitId: uuidSchema,
    userId: uuidSchema,
    role: unitRoleKindSchema,
  })
  .strict()
export type AssignUnitRoleBody = z.infer<typeof assignUnitRoleBodySchema>

export const unitRoleParamsSchema = z.object({
  departmentId: uuidSchema,
  unitRoleId: uuidSchema,
})

export const memberSchema = z.object({
  userId: uuidSchema,
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  membershipRole: membershipRoleSchema,
  unitId: uuidSchema.nullable(),
  unitRole: unitRoleKindSchema.nullable(),
})
export type MemberDto = z.infer<typeof memberSchema>

export const membersListSchema = z.array(memberSchema)

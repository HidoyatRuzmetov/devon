// Zod schemas for the custom-fields module (v1.1 SPEC §5). The *model* -- types, caps, the key shape,
// the personal-data blocklist and the value rules -- lives in `@devon/contracts`
// (`packages/contracts/src/custom-fields.ts`) so the browser refuses exactly what the server refuses;
// this file only describes how it crosses the wire.
import { z } from 'zod'
import {
  FIELD_KEY_RE,
  FIELD_REMINDER_MAX_DAYS,
  FIELD_REMINDER_MIN_DAYS,
  FIELD_TYPES,
} from '@devon/contracts'
import { LOCALES } from '../../schemas.js'

export const appliesToSchema = z.enum(['card', 'person'])
export const fieldTypeSchema = z.enum(FIELD_TYPES)
export const visibilitySchema = z.enum(['everyone', 'head_only'])

/** A label map is `{ "uz-Latn": "...", ... }`. Every key must be one of the four product locales, and
 * at least one must carry text -- a column with no name in any language is not a column. */
export const localizedMapSchema = z
  .partialRecord(z.enum(LOCALES), z.string().trim().max(120))
  .refine((map) => Object.values(map).some((v) => (v ?? '').trim().length > 0), {
    message: 'at_least_one_locale',
  })

export const optionalLocalizedMapSchema = z
  .partialRecord(z.enum(LOCALES), z.string().trim().max(400))
  .nullable()
  .optional()

export const fieldValueSchema = z.union([
  z.string().max(4000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
])

export const fieldOptionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[\p{L}\p{N}_-]+$/u),
  label: localizedMapSchema,
  /** A token name from DESIGN.md's label palette -- never a raw hex value (I-9 / tokens only). */
  colorToken: z.enum(['slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink']),
  order: z.number().int().min(0).max(200),
})

export const createDefSchema = z
  .object({
    appliesTo: appliesToSchema,
    key: z.string().trim().regex(FIELD_KEY_RE),
    label: localizedMapSchema,
    description: optionalLocalizedMapSchema,
    type: fieldTypeSchema,
    options: z.array(fieldOptionSchema).max(50).default([]),
    required: z.boolean().default(false),
    defaultValue: fieldValueSchema.default(null),
    showInTable: z.boolean().default(true),
    showOnCardTile: z.boolean().default(false),
    selfEditable: z.boolean().default(true),
    visibleTo: visibilitySchema.default('everyone'),
    reminderDays: z
      .number()
      .int()
      .min(FIELD_REMINDER_MIN_DAYS)
      .max(FIELD_REMINDER_MAX_DAYS)
      .default(3),
  })
  .strict()

export const updateDefSchema = createDefSchema
  .omit({ appliesTo: true, key: true })
  .partial()
  .strict()

export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).strict()

export const defParamsSchema = z.object({ id: z.string().uuid() })

export const defsQuerySchema = z.object({
  appliesTo: appliesToSchema.optional(),
  /** `1` also returns archived definitions -- the manager's "Arxiv" filter and the undo path. */
  includeArchived: z.coerce.boolean().optional(),
})

export const fieldDefDtoSchema = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid(),
  appliesTo: appliesToSchema,
  key: z.string(),
  label: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).nullable(),
  type: fieldTypeSchema,
  options: z.array(
    z.object({
      id: z.string(),
      label: z.record(z.string(), z.string()),
      colorToken: z.string(),
      order: z.number().int(),
    }),
  ),
  required: z.boolean(),
  defaultValue: fieldValueSchema,
  showInTable: z.boolean(),
  showOnCardTile: z.boolean(),
  selfEditable: z.boolean(),
  visibleTo: visibilitySchema,
  order: z.number().int(),
  reminderDays: z.number().int(),
  archivedAt: z.string().nullable(),
  /** Head-only, and `null` for everyone else: filled / total across the department's active members. */
  progress: z
    .object({
      filled: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      openRequests: z.number().int().nonnegative(),
    })
    .nullable(),
})

export const defsResponseSchema = z.object({
  defs: z.array(fieldDefDtoSchema),
  /** SPEC §5 caps, echoed so the manager can say "17 / 20" without hard-coding the number. */
  caps: z.object({ card: z.number().int(), person: z.number().int() }),
  canManage: z.boolean(),
})

export const defResponseSchema = z.object({ def: fieldDefDtoSchema })

export const valuesQuerySchema = z.object({
  subjectType: appliesToSchema,
  /** Comma-separated card ids, or membership ids for a person field. */
  subjectIds: z.string().max(8000).optional(),
  /** Comma-separated user ids -- the people table's key. Resolved to memberships server-side. */
  userIds: z.string().max(8000).optional(),
})

export const fieldValueDtoSchema = z.object({
  defId: z.string().uuid(),
  key: z.string(),
  subjectType: appliesToSchema,
  subjectId: z.string().uuid(),
  subjectUserId: z.string().uuid().nullable(),
  value: fieldValueSchema,
  updatedByUserId: z.string().uuid().nullable(),
  updatedAt: z.string().nullable(),
})

export const valuesResponseSchema = z.object({ values: z.array(fieldValueDtoSchema) })

export const setValueSchema = z
  .object({
    defId: z.string().uuid(),
    /** A card id, or a membership id for a person field. Omit for `subjectUserId`. */
    subjectId: z.string().uuid().optional(),
    /** The person a value is about, when the caller knows the user rather than the membership. */
    subjectUserId: z.string().uuid().optional(),
    value: fieldValueSchema,
  })
  .strict()

export const setManySchema = z.object({ items: z.array(setValueSchema).min(1).max(50) }).strict()

export const notifyResponseSchema = z.object({
  filled: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  openRequests: z.number().int().nonnegative(),
  /** How many people were asked by *this* call -- the toast says a number, not "done". */
  asked: z.number().int().nonnegative(),
  reminded: z.number().int().nonnegative(),
})

export const myFieldSchema = z.object({
  def: fieldDefDtoSchema,
  value: fieldValueSchema,
  updatedAt: z.string().nullable(),
  /** True while the head's request for this field is still open. */
  requested: z.boolean(),
  requestedAt: z.string().nullable(),
  /** False when the head keeps this column to themselves (`selfEditable: false`). */
  editable: z.boolean(),
})

export const myFieldsResponseSchema = z.object({
  membershipId: z.string().uuid().nullable(),
  fields: z.array(myFieldSchema),
  missingRequired: z.number().int().nonnegative(),
  openRequests: z.number().int().nonnegative(),
})

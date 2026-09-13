// Typed endpoint functions for `/api/v1/fields/*` (MODULE-GUIDE.md "Web features"). This feature's
// own copy of `apps/api/src/modules/fields/schemas.ts`'s wire shapes, validated at the fetch
// boundary -- the same "no shared DTO package" tradeoff every other feature's `api.ts` documents.
//
// The field *model* is NOT copied: `FieldType`, `FIELD_CAPS`, the key shape, the personal-data
// blocklist and `validateFieldValue` all live in `@devon/contracts` and both sides import them,
// because a value the browser accepts and the server refuses is the one bug a fill form must never
// have.
import { z } from 'zod'
import { FIELD_TYPES } from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'

export const fieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])
export type WireFieldValue = z.infer<typeof fieldValueSchema>

export const fieldOptionSchema = z.object({
  id: z.string(),
  label: z.record(z.string(), z.string()),
  colorToken: z.string(),
  order: z.number().int(),
})
export type FieldOptionDto = z.infer<typeof fieldOptionSchema>

export const fieldDefSchema = z.object({
  id: z.string(),
  departmentId: z.string(),
  appliesTo: z.enum(['card', 'person']),
  key: z.string(),
  label: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).nullable(),
  type: z.enum(FIELD_TYPES),
  options: z.array(fieldOptionSchema),
  required: z.boolean(),
  defaultValue: fieldValueSchema,
  showInTable: z.boolean(),
  showOnCardTile: z.boolean(),
  selfEditable: z.boolean(),
  visibleTo: z.enum(['everyone', 'head_only']),
  order: z.number().int(),
  reminderDays: z.number().int(),
  archivedAt: z.string().nullable(),
  progress: z
    .object({
      filled: z.number().int(),
      total: z.number().int(),
      openRequests: z.number().int(),
    })
    .nullable(),
})
export type FieldDefDto = z.infer<typeof fieldDefSchema>

export const defsResponseSchema = z.object({
  defs: z.array(fieldDefSchema),
  caps: z.object({ card: z.number().int(), person: z.number().int() }),
  canManage: z.boolean(),
})
export type DefsResponse = z.infer<typeof defsResponseSchema>

export const defResponseSchema = z.object({ def: fieldDefSchema })

export const fieldValueRecordSchema = z.object({
  defId: z.string(),
  key: z.string(),
  subjectType: z.enum(['card', 'person']),
  subjectId: z.string(),
  subjectUserId: z.string().nullable(),
  value: fieldValueSchema,
  updatedByUserId: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type FieldValueRecordDto = z.infer<typeof fieldValueRecordSchema>

export const valuesResponseSchema = z.object({ values: z.array(fieldValueRecordSchema) })

export const notifyResponseSchema = z.object({
  filled: z.number().int(),
  total: z.number().int(),
  openRequests: z.number().int(),
  asked: z.number().int(),
  reminded: z.number().int(),
})
export type NotifyResult = z.infer<typeof notifyResponseSchema>

export const myFieldSchema = z.object({
  def: fieldDefSchema,
  value: fieldValueSchema,
  updatedAt: z.string().nullable(),
  requested: z.boolean(),
  requestedAt: z.string().nullable(),
  editable: z.boolean(),
})
export type MyField = z.infer<typeof myFieldSchema>

export const myFieldsResponseSchema = z.object({
  membershipId: z.string().nullable(),
  fields: z.array(myFieldSchema),
  missingRequired: z.number().int(),
  openRequests: z.number().int(),
})
export type MyFieldsResponse = z.infer<typeof myFieldsResponseSchema>

export type DefDraft = {
  appliesTo: 'card' | 'person'
  key: string
  label: Record<string, string>
  description?: Record<string, string> | null
  type: FieldDefDto['type']
  options: FieldOptionDto[]
  required: boolean
  defaultValue: WireFieldValue
  showInTable: boolean
  showOnCardTile: boolean
  selfEditable: boolean
  visibleTo: 'everyone' | 'head_only'
  reminderDays: number
}

export function fetchDefs(
  appliesTo?: 'card' | 'person',
  includeArchived = false,
): Promise<DefsResponse> {
  const params = new URLSearchParams()
  if (appliesTo) params.set('appliesTo', appliesTo)
  if (includeArchived) params.set('includeArchived', 'true')
  const query = params.toString()
  return apiClient.get(`/api/v1/fields/defs${query ? `?${query}` : ''}`, defsResponseSchema)
}

export function createDef(draft: DefDraft, csrfToken: string): Promise<{ def: FieldDefDto }> {
  return apiClient.post('/api/v1/fields/defs', draft, defResponseSchema, csrfToken)
}

export function updateDef(
  id: string,
  patch: Partial<Omit<DefDraft, 'appliesTo' | 'key'>>,
  csrfToken: string,
): Promise<{ def: FieldDefDto }> {
  return apiClient.patch(`/api/v1/fields/defs/${id}`, patch, defResponseSchema, csrfToken)
}

export function archiveDef(id: string, csrfToken: string): Promise<{ def: FieldDefDto }> {
  return apiClient.post(`/api/v1/fields/defs/${id}/archive`, {}, defResponseSchema, csrfToken)
}

export function restoreDef(id: string, csrfToken: string): Promise<{ def: FieldDefDto }> {
  return apiClient.post(`/api/v1/fields/defs/${id}/restore`, {}, defResponseSchema, csrfToken)
}

export function reorderDefs(ids: readonly string[], csrfToken: string): Promise<void> {
  return apiClient.post(
    '/api/v1/fields/defs/reorder',
    { ids: [...ids] },
    z.void(),
    csrfToken,
  ) as Promise<void>
}

export function notifyToFill(id: string, csrfToken: string): Promise<NotifyResult> {
  return apiClient.post(`/api/v1/fields/defs/${id}/notify`, {}, notifyResponseSchema, csrfToken)
}

export function fetchValues(input: {
  subjectType: 'card' | 'person'
  subjectIds?: readonly string[]
  userIds?: readonly string[]
}): Promise<{ values: FieldValueRecordDto[] }> {
  const params = new URLSearchParams({ subjectType: input.subjectType })
  if (input.subjectIds?.length) params.set('subjectIds', input.subjectIds.join(','))
  if (input.userIds?.length) params.set('userIds', input.userIds.join(','))
  return apiClient.get(`/api/v1/fields/values?${params.toString()}`, valuesResponseSchema)
}

export function setValue(
  input: {
    defId: string
    subjectId?: string
    subjectUserId?: string
    value: WireFieldValue
  },
  csrfToken: string,
): Promise<void> {
  return apiClient.put('/api/v1/fields/values', input, z.void(), csrfToken) as Promise<void>
}

export function fetchMyFields(): Promise<MyFieldsResponse> {
  return apiClient.get('/api/v1/fields/me', myFieldsResponseSchema)
}

export function saveMyFields(
  items: ReadonlyArray<{ defId: string; value: WireFieldValue }>,
  csrfToken: string,
): Promise<MyFieldsResponse> {
  return apiClient.put(
    '/api/v1/fields/me',
    { items: [...items] },
    myFieldsResponseSchema,
    csrfToken,
  )
}

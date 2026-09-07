// Zod schemas for the pages/onboarding-lite module (TECH-SPEC §3.5), module-owned per
// MODULE-GUIDE.md -- never added to the shared `apps/api/src/schemas.ts`.
import { z } from 'zod'

const idSchema = z.string().uuid()
const isoDateTime = z.iso.datetime({ offset: true })

export const pageKindSchema = z.enum(['how_we_work', 'onboarding', 'brief', 'note'])

// A Tiptap `JSONContent` node: `{ type, attrs?, content?, text?, marks? }`, recursive. Validated for
// gross shape and a size ceiling here, never element by element -- the same posture
// `personal/schemas.ts`'s `sceneSchema` already takes for an equally open-ended editor payload
// (mentions/checklist-items/callouts are just node/mark `type` strings this schema does not enumerate,
// exactly like the canvas scene does not enumerate every Excalidraw element type).
export type TiptapNode = {
  type: string
  attrs?: Record<string, unknown> | undefined
  content?: TiptapNode[] | undefined
  text?: string | undefined
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined
}

const tiptapMarkSchema = z.object({
  type: z.string().min(1).max(60),
  attrs: z.record(z.string(), z.unknown()).optional(),
})

const tiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(60),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(tiptapNodeSchema).max(4000).optional(),
    text: z.string().max(20000).optional(),
    marks: z.array(tiptapMarkSchema).max(20).optional(),
  }),
)

export const pageBlocksSchema = tiptapNodeSchema.refine(
  (v) => JSON.stringify(v).length <= 2_000_000,
  { message: 'Page content is too large' },
)

const EMPTY_DOC: TiptapNode = { type: 'doc', content: [] }

export const pageSummarySchema = z.object({
  id: idSchema,
  kind: pageKindSchema,
  title: z.string(),
  createdByUserId: idSchema,
  updatedByUserId: idSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export type PageSummaryDto = z.infer<typeof pageSummarySchema>
export const pageSummaryListSchema = z.array(pageSummarySchema)

export const pageSchema = pageSummarySchema.extend({ blocks: pageBlocksSchema })
export type PageDto = z.infer<typeof pageSchema>

export const createPageBodySchema = z.object({
  kind: pageKindSchema.default('note'),
  title: z.string().trim().min(1).max(300),
  blocks: pageBlocksSchema.optional(),
})

export const patchPageBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  blocks: pageBlocksSchema.optional(),
  version: z.number().int(),
})

export const pageVersionSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  authorUserId: idSchema,
  createdAt: isoDateTime,
})
export type PageVersionSummaryDto = z.infer<typeof pageVersionSummarySchema>
export const pageVersionListSchema = z.array(pageVersionSummarySchema)

export const pageVersionSchema = pageVersionSummarySchema.extend({ blocks: pageBlocksSchema })
export type PageVersionDto = z.infer<typeof pageVersionSchema>

export const restoreVersionBodySchema = z.object({ versionId: idSchema })

// -- Onboarding templates ---------------------------------------------------------------------------

export const onboardingOwnerRoleSchema = z.enum(['newcomer', 'head', 'buddy'])

export const onboardingItemSchema = z.object({
  id: z.string().min(1).max(60),
  text: z.string().trim().min(1).max(500),
  ownerRole: onboardingOwnerRoleSchema,
  sort: z.number().int(),
})
export type OnboardingItemDto = z.infer<typeof onboardingItemSchema>

export const onboardingTemplateSchema = z.object({
  id: idSchema,
  name: z.string(),
  enabled: z.boolean(),
  items: z.array(onboardingItemSchema).max(100),
  createdByUserId: idSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  version: z.number().int(),
})
export type OnboardingTemplateDto = z.infer<typeof onboardingTemplateSchema>
export const onboardingTemplateListSchema = z.array(onboardingTemplateSchema)

export const createOnboardingTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional(),
  items: z
    .array(onboardingItemSchema.omit({ sort: true }))
    .max(100)
    .optional(),
})

export const patchOnboardingTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  items: z.array(onboardingItemSchema).max(100).optional(),
  version: z.number().int(),
})

export { EMPTY_DOC }

// Client-side mirror of `apps/api/src/modules/pages/schemas.ts` (same convention as
// `src/lib/api-schemas.ts` mirroring the foundation's `apps/api/src/schemas.ts`).
import { z } from 'zod'

export type TiptapNode = {
  type: string
  attrs?: Record<string, unknown> | undefined
  content?: TiptapNode[] | undefined
  text?: string | undefined
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined
}

const tiptapMarkSchema: z.ZodType<{ type: string; attrs?: Record<string, unknown> | undefined }> =
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })

const tiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(tiptapNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(tiptapMarkSchema).optional(),
  }),
)

export const pageKindSchema = z.enum(['how_we_work', 'onboarding', 'brief', 'note'])
export type PageKind = z.infer<typeof pageKindSchema>

export const pageSummarySchema = z.object({
  id: z.string(),
  kind: pageKindSchema,
  title: z.string(),
  createdByUserId: z.string(),
  updatedByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type PageSummary = z.infer<typeof pageSummarySchema>
export const pageSummaryListSchema = z.array(pageSummarySchema)

export const pageSchema = pageSummarySchema.extend({ blocks: tiptapNodeSchema })
export type Page = z.infer<typeof pageSchema>

export type CreatePageInput = { kind: PageKind; title: string; blocks?: TiptapNode }
export type PatchPageInput = { title?: string; blocks?: TiptapNode; version: number }

export const pageVersionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  authorUserId: z.string(),
  createdAt: z.string(),
})
export type PageVersionSummary = z.infer<typeof pageVersionSummarySchema>
export const pageVersionListSchema = z.array(pageVersionSummarySchema)

export const pageVersionSchema = pageVersionSummarySchema.extend({ blocks: tiptapNodeSchema })
export type PageVersion = z.infer<typeof pageVersionSchema>

export const onboardingOwnerRoleSchema = z.enum(['newcomer', 'head', 'buddy'])
export type OnboardingOwnerRole = z.infer<typeof onboardingOwnerRoleSchema>

export const onboardingItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  ownerRole: onboardingOwnerRoleSchema,
  sort: z.number().int(),
})
export type OnboardingItem = z.infer<typeof onboardingItemSchema>

export const onboardingTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  items: z.array(onboardingItemSchema),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type OnboardingTemplate = z.infer<typeof onboardingTemplateSchema>
export const onboardingTemplateListSchema = z.array(onboardingTemplateSchema)

export type CreateOnboardingTemplateInput = {
  name: string
  enabled?: boolean
  items?: { id: string; text: string; ownerRole: OnboardingOwnerRole }[]
}
export type PatchOnboardingTemplateInput = {
  name?: string
  enabled?: boolean
  items?: OnboardingItem[]
  version: number
}

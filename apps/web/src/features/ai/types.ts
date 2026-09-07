// Zod schemas mirroring the server's wire shapes (`apps/api/src/modules/ai/schemas.ts`) -- kept as
// this feature's own duplicate, same convention `personal`'s `types.ts` already follows (MODULE-GUIDE.md
// "Web features": every feature builds its own typed endpoint functions; there is no shared DTO
// package, and there never should be).
import { z } from 'zod'

export const AI_FEATURE_IDS = [
  'quick_add_parse',
  'subtask_breakdown',
  'plan_sprint',
  'deadline_risk',
  'weekly_summary',
  'draft_event',
  'summarize_thread',
  'nl_analytics',
  'translate',
  'what_did_i_miss',
] as const
export const aiFeatureSchema = z.enum(AI_FEATURE_IDS)
export type AiFeatureId = z.infer<typeof aiFeatureSchema>

export const aiSettingsSchema = z.object({
  departmentId: z.string().uuid(),
  budgetUzsPerMonth: z.number().int(),
  softCapPct: z.number().int(),
  flags: z.record(z.string(), z.boolean()),
  spentUzsThisMonth: z.number().int(),
  remainingUzs: z.number().int(),
  budgetStatus: z.enum(['ok', 'soft_cap', 'hard_stop']),
  usedPct: z.number(),
})
export type AiSettings = z.infer<typeof aiSettingsSchema>

export const patchAiSettingsInputSchema = z.object({
  budgetUzsPerMonth: z.number().int().min(0).optional(),
  softCapPct: z.number().int().min(1).max(100).optional(),
  // Partial: plain string keys, not `aiFeatureSchema`-keyed (see the server's identical schema in
  // `apps/api/src/modules/ai/schemas.ts` for why a `z.record(enumSchema, ...)` would wrongly require
  // every feature key on every PATCH, even one that only ever flips a single flag).
  flags: z.record(z.string(), z.boolean()).optional(),
})
export type PatchAiSettingsInput = z.infer<typeof patchAiSettingsInputSchema>

export const traceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  feature: aiFeatureSchema,
  model: z.string(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUzs: z.number().int(),
  latencyMs: z.number().int(),
  retried: z.boolean(),
  status: z.enum([
    'ok',
    'empty_after_retry',
    'schema_invalid_after_retry',
    'provider_error',
    'blocked_budget',
    'blocked_flag',
  ]),
  createdAt: z.string(),
})
export type Trace = z.infer<typeof traceSchema>

export const usageListSchema = z.object({ traces: z.array(traceSchema) })

export const runFeatureResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  meta: z.object({
    feature: aiFeatureSchema,
    model: z.string(),
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalTokens: z.number().int(),
    costUzs: z.number().int(),
    latencyMs: z.number().int(),
    retried: z.boolean(),
  }),
})
export type RunFeatureResponse = z.infer<typeof runFeatureResponseSchema>

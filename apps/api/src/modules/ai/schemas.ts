// Zod schemas for the AI module (TECH-SPEC §8). Kept inside the module's own folder -- never added to
// `apps/api/src/schemas.ts` (MODULE-GUIDE.md: a module never edits a file another module also
// touches).
import { z } from 'zod'

// Mirrors `@devon/ai`'s `AiFeature` union exactly (kept as a local literal tuple, not imported, so a
// route param validates with a real Zod enum rather than a runtime array cast -- `test/unit/ai/
// features.test.ts` asserts the two lists stay identical).
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

export const featureParamsSchema = z.object({ feature: aiFeatureSchema })

/** The body's `input` is validated a second time, feature-specifically, by `@devon/ai`'s own
 * `runFeature()` (each feature's `inputSchema`) -- this outer schema only guards against a body that
 * is not even a plain object, so a malformed request never reaches the gateway at all. */
export const runFeatureBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
})

const runMetaSchema = z.object({
  feature: aiFeatureSchema,
  model: z.string(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUzs: z.number().int(),
  latencyMs: z.number().int(),
  retried: z.boolean(),
})

export type RunFeatureResponse = z.infer<typeof runFeatureResponseSchema>
export const runFeatureResponseSchema = z.object({
  /** Opaque, feature-specific JSON (`@devon/ai`'s per-feature output schema already validated it
   * server-side) -- a single dynamic `:feature` route cannot carry ten different typed response
   * shapes through `fastify-type-provider-zod`'s per-route `schema.response`, so the client's own
   * `api.ts` re-validates against the matching Zod schema it imports from `@devon/ai` before use. */
  data: z.record(z.string(), z.unknown()),
  meta: runMetaSchema,
})

export const aiSettingsSchema = z.object({
  departmentId: z.string().uuid(),
  budgetUzsPerMonth: z.number().int().min(0),
  softCapPct: z.number().int().min(1).max(100),
  flags: z.record(z.string(), z.boolean()),
  spentUzsThisMonth: z.number().int().min(0),
  remainingUzs: z.number().int().min(0),
  budgetStatus: z.enum(['ok', 'soft_cap', 'hard_stop']),
  usedPct: z.number().min(0),
  // H8.1 graceful degradation (additive field, backward compatible -- see `errors.ts`'s
  // `AiUnavailableError` doc comment). `flags` above is already forced all-`false` whenever this is
  // `false`, so a web client that has never heard of this field still hides every AI entry point
  // correctly; a client that *does* read it can show a clearer "AI is temporarily unavailable" hint
  // instead of just a disabled button.
  available: z.boolean(),
  unavailableReason: z.enum(['circuit_open']).nullable(),
})
export type AiSettingsDto = z.infer<typeof aiSettingsSchema>

export const patchAiSettingsBodySchema = z.object({
  budgetUzsPerMonth: z.number().int().min(0).max(1_000_000_000).optional(),
  softCapPct: z.number().int().min(1).max(100).optional(),
  // A partial update (typically one flag at a time from the settings screen) -- plain string keys,
  // not `aiFeatureSchema`-keyed, because `z.record(enumSchema, ...)` infers a *complete* record
  // requiring every enum member present, which a one-flag PATCH body never is. `service.ts` merges
  // whatever keys are given into the existing flags object; an unrecognised key is simply inert
  // (never read by `@devon/ai`'s feature registry), not rejected -- the same forward-compatible
  // posture `flags` already has on the GET response above.
  flags: z.record(z.string(), z.boolean()).optional(),
})

export const traceDtoSchema = z.object({
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
  createdAt: z.iso.datetime({ offset: true }),
})
export type TraceDto = z.infer<typeof traceDtoSchema>

export const usageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const usageListResponseSchema = z.object({
  traces: z.array(traceDtoSchema),
})

// Zod schemas mirroring the server's wire shapes (`apps/api/src/modules/ai/schemas.ts`) -- kept as
// this feature's own duplicate, same convention `personal`'s `types.ts` already follows (MODULE-GUIDE.md
// "Web features": every feature builds its own typed endpoint functions; there is no shared DTO
// package, and there never should be).
//
// v1.1 (SPEC §8, AI-AUDIT §4): ten feature ids became fourteen. `weekly_summary` and
// `what_did_i_miss` merged into `catch_up`; `draft_reply`, `board_risk_digest`, `suggest_assignee`,
// `duplicate_check` and `semantic_ask` are new. The two merged ids survive in `AI_TRACE_FEATURE_IDS`
// only, because the Usage tab reads history and history is not rewritten by a merge.
import { z } from 'zod'

export const AI_FEATURE_IDS = [
  'quick_add_parse',
  'subtask_breakdown',
  'plan_sprint',
  'deadline_risk',
  'catch_up',
  'draft_event',
  'summarize_thread',
  'nl_analytics',
  'translate',
  'draft_reply',
  'board_risk_digest',
  'suggest_assignee',
  'duplicate_check',
  'semantic_ask',
] as const
export const aiFeatureSchema = z.enum(AI_FEATURE_IDS)
export type AiFeatureId = z.infer<typeof aiFeatureSchema>

export const AI_TRACE_FEATURE_IDS = [
  ...AI_FEATURE_IDS,
  'weekly_summary',
  'what_did_i_miss',
] as const
export const aiTraceFeatureSchema = z.enum(AI_TRACE_FEATURE_IDS)
export type AiTraceFeatureId = z.infer<typeof aiTraceFeatureSchema>

/**
 * SPEC §2.2 + §8: three helpers exist to answer a management question about *other people*. The
 * server refuses them for a member (`featureRunSubject` → `department_managed`); this list is the
 * matching client-side hide, so a member never sees a button that would 403. The client hiding is
 * never the enforcement -- it is the manners.
 *
 * `catch_up` is not here: the feature is every member's own "what did I miss", and only its
 * `scope: 'department'` variant is managerial (checked separately, on the server).
 */
export const HEAD_ONLY_FEATURES: readonly AiFeatureId[] = ['board_risk_digest', 'suggest_assignee']

/** i18n message keys use camelCase, never the snake_case `AiFeatureId` values directly: `plan_sprint`
 * flattened straight into a message key (`ai.features.plan_sprint.label`) trips the banned-word scan
 * (`packages/i18n/test/unit/banned.test.ts`) -- its whole-word boundary treats `_` as a separator, so
 * "sprint" inside "plan_sprint" reads as the standalone English project-management word the scan
 * exists to keep out of shipped copy, even though it is really just this feature's machine id.
 * Renaming the *feature id* to dodge that would touch `@devon/ai`'s `AiFeature` union, every route,
 * and every trace already keyed by it -- translating only the i18n key segment is the smaller, correct
 * fix. */
export const FEATURE_KEY_SEGMENT: Record<AiTraceFeatureId, string> = {
  quick_add_parse: 'quickAddParse',
  subtask_breakdown: 'subtaskBreakdown',
  plan_sprint: 'planSprint',
  deadline_risk: 'deadlineRisk',
  catch_up: 'catchUp',
  draft_event: 'draftEvent',
  summarize_thread: 'summarizeThread',
  nl_analytics: 'nlAnalytics',
  translate: 'translate',
  draft_reply: 'draftReply',
  board_risk_digest: 'boardRiskDigest',
  suggest_assignee: 'suggestAssignee',
  duplicate_check: 'duplicateCheck',
  semantic_ask: 'semanticAsk',
  weekly_summary: 'weeklySummary',
  what_did_i_miss: 'whatDidIMiss',
}

export function featureLabelKey(feature: AiTraceFeatureId): string {
  return `ai.features.${FEATURE_KEY_SEGMENT[feature]}.label`
}

export function featureDescriptionKey(feature: AiTraceFeatureId): string {
  return `ai.features.${FEATURE_KEY_SEGMENT[feature]}.description`
}

/** AI-AUDIT §0.5: "where does this live" is the question a member actually has on `/ai`, and the
 * v1.0 screen answered none of it. One line per helper, naming the screen it appears on. */
export function featureWhereKey(feature: AiTraceFeatureId): string {
  return `ai.features.${FEATURE_KEY_SEGMENT[feature]}.where`
}

/** A concrete, department-flavoured example of what the helper turns in and turns out. */
export function featureExampleKey(feature: AiTraceFeatureId): string {
  return `ai.features.${FEATURE_KEY_SEGMENT[feature]}.example`
}

export const searchBackendSchema = z.object({
  backend: z.enum(['embeddings', 'fts']),
  model: z.string().nullable(),
  dimensions: z.number().int().nullable(),
  reason: z.enum([
    'ok',
    'no_api_key',
    'models_endpoint_unreachable',
    'no_embeddings_model_listed',
    'embeddings_endpoint_failed',
    'dimension_mismatch',
  ]),
  checkedAt: z.string(),
  indexedCount: z.number().int(),
  pendingEmbeddingCount: z.number().int(),
})
export type SearchBackend = z.infer<typeof searchBackendSchema>

export const aiSettingsSchema = z.object({
  departmentId: z.string().uuid(),
  // v1.1 SPEC §2.2 (D2a): the money fields are head-only and are simply absent from a member's
  // payload. Optional here, and every reader below treats "absent" as "not yours to see" rather than
  // as zero -- a zero budget is a different, wrong statement.
  budgetUzsPerMonth: z.number().int().optional(),
  softCapPct: z.number().int(),
  flags: z.record(z.string(), z.boolean()),
  spentUzsThisMonth: z.number().int().optional(),
  remainingUzs: z.number().int().optional(),
  budgetStatus: z.enum(['ok', 'soft_cap', 'hard_stop']).optional(),
  usedPct: z.number().optional(),
  available: z.boolean().optional(),
  unavailableReason: z.enum(['circuit_open']).nullable().optional(),
  /** AI-AUDIT §5 fix 15 -- head-only. */
  spendByFeature: z.record(z.string(), z.number().int()).optional(),
  /** SEV3 #30: the estimated cost of one call of each helper, in soʻm. Everyone sees it -- it is
   * part of what the helper *is*, not part of what the department spent. `.default({})` so a server
   * that predates this field still renders (the price simply does not show). */
  estimatedCostUzsPerCall: z.record(z.string(), z.number().int()).default({}),
  /** No key configured: every answer in this deployment comes from the offline simulator. */
  simulated: z.boolean(),
  search: searchBackendSchema,
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
  feature: aiTraceFeatureSchema,
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
  /** SPEC §12: "who ran it". Empty for a person no longer in the department. */
  userName: z.string(),
})
export type Trace = z.infer<typeof traceSchema>

export const usageListSchema = z.object({ traces: z.array(traceSchema) })

export const runMetaSchema = z.object({
  feature: aiFeatureSchema,
  model: z.string(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUzs: z.number().int(),
  latencyMs: z.number().int(),
  retried: z.boolean(),
  cached: z.boolean().optional(),
  /** SPEC §8 "Honesty": this answer is a simulation, and the panel says so in amber. */
  simulated: z.boolean(),
})
export type RunMeta = z.infer<typeof runMetaSchema>

export const runFeatureResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  meta: runMetaSchema,
})
export type RunFeatureResponse = z.infer<typeof runFeatureResponseSchema>

// --- EPIC-016: semantic search + the Ask box ---------------------------------------------------

export const searchHitSchema = z.object({
  subjectType: z.enum(['card', 'comment', 'page', 'event']),
  subjectId: z.string().uuid(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
  via: z.enum(['embeddings', 'fts', 'trigram']),
})
export type SearchHit = z.infer<typeof searchHitSchema>

export const searchResponseSchema = z.object({
  hits: z.array(searchHitSchema),
  backend: z.enum(['embeddings', 'fts']),
})

export const askResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  meta: runMetaSchema,
  sources: z.array(searchHitSchema),
  backend: z.enum(['embeddings', 'fts']),
})
export type AskResponse = z.infer<typeof askResponseSchema>

export const reindexResponseSchema = z.object({
  indexed: z.number().int(),
  embedded: z.number().int(),
  backend: z.enum(['embeddings', 'fts']),
})

/** Where a search hit lives, so the palette and the Ask box link to the same place. */
export function searchHitHref(hit: Pick<SearchHit, 'subjectType' | 'subjectId'>): string {
  switch (hit.subjectType) {
    case 'card':
      return `/work/card?id=${hit.subjectId}`
    case 'comment':
      return `/work/card?id=${hit.subjectId}`
    case 'page':
      return `/pages?id=${hit.subjectId}`
    case 'event':
      return `/events?id=${hit.subjectId}`
  }
}

/** `card:<uuid>` → a hit-shaped object the link helper above understands. Returns `null` for a ref
 * the model made up, which is the point: an invented citation renders as plain text, never a link. */
export function parseRef(
  ref: string,
): { subjectType: SearchHit['subjectType']; subjectId: string } | null {
  const [kind, id] = ref.split(':')
  if (!id) return null
  if (kind !== 'card' && kind !== 'comment' && kind !== 'page' && kind !== 'event') return null
  return { subjectType: kind, subjectId: id }
}

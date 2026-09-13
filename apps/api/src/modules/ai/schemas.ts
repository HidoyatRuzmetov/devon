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

/**
 * v1.1 (AI-AUDIT §4, D-1): `weekly_summary` and `what_did_i_miss` were merged into `catch_up`, but
 * `app.ai_traces` rows written before v1.1 still carry those two ids. They may never be *run* -- the
 * route param validates against `aiFeatureSchema` above -- but every read path that returns a trace
 * has to accept them, or the Usage tab 500s on its own history.
 */
export const AI_TRACE_FEATURE_IDS = [
  ...AI_FEATURE_IDS,
  'weekly_summary',
  'what_did_i_miss',
] as const
export const aiTraceFeatureSchema = z.enum(AI_TRACE_FEATURE_IDS)
export type AiTraceFeatureId = z.infer<typeof aiTraceFeatureSchema>

export const featureParamsSchema = z.object({ feature: aiFeatureSchema })

/** The body's `input` is validated a second time, feature-specifically, by `@devon/ai`'s own
 * `runFeature()` (each feature's `inputSchema`) -- this outer schema only guards against a body that
 * is not even a plain object, so a malformed request never reaches the gateway at all. */
export const runFeatureBodySchema = z
  .object({
    // H7.4 ("limits on ... AI input length"): the per-feature `inputSchema` in `@devon/ai` validates
    // the shape, but nothing bounded the *size* of what reached the gateway -- a single request could
    // hand the model an arbitrarily large prompt and bill the department for it. Bounded here, at the
    // HTTP boundary, before any of it is read.
    input: z
      .record(z.string().max(64), z.unknown())
      .refine((v) => JSON.stringify(v).length <= AI_INPUT_MAX_BYTES, {
        message: 'AI input is too large',
      }),
  })
  .strict()

/** 64 KB of JSON: comfortably more than any feature's real input, far less than a model's context. */
export const AI_INPUT_MAX_BYTES = 64 * 1024

const runMetaSchema = z.object({
  feature: aiFeatureSchema,
  model: z.string(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUzs: z.number().int(),
  latencyMs: z.number().int(),
  retried: z.boolean(),
  // H27.1 "AI calls cached by prompt hash where deterministic": true when this response was served
  // from `service.ts`'s short-TTL identical-input cache instead of a real provider call (no tokens
  // spent, no new trace row). Optional/additive so an older client that has never seen this field
  // simply ignores it -- never required, never breaks a client built before it existed.
  cached: z.boolean().optional(),
  // v1.1 SPEC §8 "Honesty": this answer came from `@devon/ai`'s offline simulator, not from GLM. The
  // preview panel shows an amber "Namunaviy javob" strip and suppresses the model/cost/latency line
  // rather than presenting a canned answer as if a ministry had paid a provider for it.
  simulated: z.boolean(),
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

/**
 * EPIC-016. Which retrieval backend the Ask box and the palette's semantic search are using, and
 * why. Probed at runtime against the configured key (`@devon/ai`'s `probeEmbeddings`) -- never a
 * build-time assumption, because the ministry's GLM deployment is documented as chat-only and may or
 * may not serve `/v1/embeddings`. `/ai` renders this as a sentence a head can read.
 */
export const searchBackendSchema = z.object({
  backend: z.enum(['embeddings', 'fts']),
  /** The embeddings model that answered the probe, when one did. */
  model: z.string().nullable(),
  dimensions: z.number().int().positive().nullable(),
  reason: z.enum([
    'ok',
    'no_api_key',
    'models_endpoint_unreachable',
    'no_embeddings_model_listed',
    'embeddings_endpoint_failed',
    'dimension_mismatch',
  ]),
  checkedAt: z.iso.datetime({ offset: true }),
  /** How many rows of this department are indexed, and how many still await an embedding. */
  indexedCount: z.number().int().min(0),
  pendingEmbeddingCount: z.number().int().min(0),
})
export type SearchBackendDto = z.infer<typeof searchBackendSchema>

export const aiSettingsSchema = z.object({
  departmentId: z.string().uuid(),
  // v1.1 SPEC §2.2 (D2a): the five money fields are head-only and are simply **absent** for a
  // member -- `.optional()`, never a zero, because a zero budget is a different statement from "this
  // is not yours to see". A member still receives `flags`/`available`, which is what they need to
  // know which helpers exist.
  budgetUzsPerMonth: z.number().int().min(0).optional(),
  softCapPct: z.number().int().min(1).max(100),
  flags: z.record(z.string(), z.boolean()),
  spentUzsThisMonth: z.number().int().min(0).optional(),
  remainingUzs: z.number().int().min(0).optional(),
  budgetStatus: z.enum(['ok', 'soft_cap', 'hard_stop']).optional(),
  usedPct: z.number().min(0).optional(),
  // H8.1 graceful degradation (additive field, backward compatible -- see `errors.ts`'s
  // `AiUnavailableError` doc comment). `flags` above is already forced all-`false` whenever this is
  // `false`, so a web client that has never heard of this field still hides every AI entry point
  // correctly; a client that *does* read it can show a clearer "AI is temporarily unavailable" hint
  // instead of just a disabled button.
  available: z.boolean(),
  unavailableReason: z.enum(['circuit_open']).nullable(),
  // AI-AUDIT §5 fix 15: per-feature spend this month, head-only, so a head can switch off the one
  // expensive helper instead of switching off AI. Absent (not empty) for a member, same rule as the
  // four money fields above.
  spendByFeature: z.record(z.string(), z.number().int().min(0)).optional(),
  /** v1.1 critique SEV3 #30: the estimated cost of ONE call of each helper, in soʻm, derived from
   * that helper's own prompt and tool schema (`@devon/ai`'s `estimatedCostUzsPerCall`). Distinct
   * from `spendByFeature`, which is what the department has actually spent this month -- a helper
   * nobody has run yet has a price but no spend, which is exactly the case that used to render as a
   * blank. Visible to everyone: "what does this cost to ask" is not a money secret, it is the
   * catalogue's own description of the tool. */
  estimatedCostUzsPerCall: z.record(z.string(), z.number().int().min(0)),
  // v1.1 SPEC §8 "Honesty": is a real key configured at all? Everyone sees this -- a member pressing
  // a sparkle button deserves to know the answer is simulated before they trust it.
  simulated: z.boolean(),
  /** Which backend semantic search and the Ask box actually run on right now (EPIC-016). */
  search: searchBackendSchema,
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
  /** May be a legacy id: a trace is history, and history does not get rewritten by a merge. */
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
    // v1.1 critique SEV2 #23: "we stopped waiting", which is a different fact from "the provider
    // refused" and is the one a person can retry.
    'timeout',
    'blocked_budget',
    'blocked_flag',
  ]),
  createdAt: z.iso.datetime({ offset: true }),
  /** SPEC §12 "the AI trace has a 'who ran it' column". Resolved from `app.users` in the same query
   * so the Usage tab never has to fan out one profile lookup per row (I-9: no query in a loop). */
  userName: z.string(),
})
export type TraceDto = z.infer<typeof traceDtoSchema>

export const usageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const usageListResponseSchema = z.object({
  traces: z.array(traceDtoSchema),
})

// --- EPIC-016: semantic search + the Ask box -------------------------------------------------

export const searchSubjectKindSchema = z.enum(['card', 'comment', 'page', 'event'])
export type SearchSubjectKind = z.infer<typeof searchSubjectKindSchema>

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** Restrict to one kind -- the palette uses this for its per-section counts. */
  kind: searchSubjectKindSchema.optional(),
})

export const searchHitSchema = z.object({
  subjectType: searchSubjectKindSchema,
  subjectId: z.string().uuid(),
  title: z.string(),
  /** A short, plain-text window around the match -- never the whole body. */
  snippet: z.string(),
  /** 0..1, comparable only within one response (cosine similarity or `ts_rank`, normalised). */
  score: z.number(),
  /** Which backend produced this hit, so a mixed FTS+trigram answer stays honest about it. */
  via: z.enum(['embeddings', 'fts', 'trigram']),
})
export type SearchHitDto = z.infer<typeof searchHitSchema>

export const searchResponseSchema = z.object({
  hits: z.array(searchHitSchema),
  backend: z.enum(['embeddings', 'fts']),
})

export const askBodySchema = z
  .object({
    question: z.string().min(3).max(500),
    locale: z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']),
  })
  .strict()

export type AskResponse = z.infer<typeof askResponseSchema>
export const askResponseSchema = z.object({
  /** `@devon/ai`'s `semantic_ask` output, re-validated client-side against the same Zod schema. */
  data: z.record(z.string(), z.unknown()),
  meta: runMetaSchema,
  /** The retrieved sources the answer was allowed to cite, so the client can render real links
   * instead of trusting an id the model produced. */
  sources: z.array(searchHitSchema),
  backend: z.enum(['embeddings', 'fts']),
})

export const reindexResponseSchema = z.object({
  indexed: z.number().int().min(0),
  embedded: z.number().int().min(0),
  backend: z.enum(['embeddings', 'fts']),
})

// --- the cached department briefing (v1.1 recapture #23) -------------------------------------

/** Where a department's briefing is in its lifecycle. `queued`/`running` are the two the tile draws
 * as one quiet "tayyorlanmoqda" -- the difference between them matters to the job runner, not to a
 * head reading Home. */
export const briefingStatusSchema = z.enum(['queued', 'running', 'ready', 'failed'])

export const briefingResponseSchema = z.object({
  /** Null on a department that has never produced one -- a brand-new boshqarma, or one whose helper
   * has never been switched on. The tile has a designed empty state for exactly that (I-10). */
  briefing: z
    .object({
      /** The Tashkent day the briefing is about, `YYYY-MM-DD`. */
      day: z.string(),
      locale: z.string(),
      status: briefingStatusSchema,
      /** `@devon/ai`'s validated `catch_up` payload, citations included, re-validated client-side
       * against the same Zod schema the synchronous path used. Null until the first success. */
      data: z.record(z.string(), z.unknown()).nullable(),
      /** When the cached words were produced. The tile prints it, so "this is from last night" is
       * something the head can see rather than something the server decides for them. */
      generatedAt: z.string().nullable(),
      /** Why the latest attempt failed, if it did -- the previous `data` is still served alongside. */
      error: z.string().nullable(),
      latencyMs: z.number().int().nullable(),
    })
    .nullable(),
  /** Whether this caller may press Yangilash right now (head, outside the cooldown). */
  canRefresh: z.boolean(),
})
export type BriefingResponse = z.infer<typeof briefingResponseSchema>

export const refreshBriefingBodySchema = z
  .object({ locale: z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']) })
  .strict()

export const refreshBriefingResponseSchema = z.object({
  status: briefingStatusSchema,
  /** Set when the request was inside the cooldown: how long until the button works again, so the
   * client can say "keyinroq urinib koʻring" with a real number instead of a shrug. */
  retryAfterMs: z.number().int().nullable(),
})

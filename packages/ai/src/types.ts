// Shared shapes for the gateway (TECH-SPEC §8, v1.1 SPEC §8). Deliberately provider-agnostic:
// everything here is the OpenAI-compatible chat-completions shape GLM-5.2 speaks
// (glm-api-instruction.md), trimmed to exactly the fields this codebase reads -- never the full
// OpenAI SDK surface.
import type { z } from 'zod'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessage = {
  role: ChatRole
  /** `null` is valid for an assistant turn that is pure tool calls (OpenAI shape). */
  content: string | null
  /** Only on a `role: 'tool'` message -- which `tool_calls[].id` this is answering. */
  toolCallId?: string
  /** Only ever set on an outgoing `role: 'assistant'` message that is replaying a prior tool call
   * back into history -- this gateway never re-sends a model's `reasoning_content` (TECH-SPEC §8:
   * "never shown or stored beyond token counts"). */
  toolCalls?: ToolCall[]
}

export type ToolCall = {
  id: string
  name: string
  /** Raw JSON string exactly as the model returned it, before this gateway's Zod parse. */
  argumentsJson: string
}

/** One allow-listed tool a feature may expose to the model (TECH-SPEC §8: "tools are allow-listed
 * per feature"). `schema` is both the JSON Schema handed to the API and the Zod validator every
 * tool-call argument is checked against before any caller ever sees it. */
export type ToolDef<T = unknown> = {
  name: string
  description: string
  schema: z.ZodType<T>
  /** Hand-authored JSON Schema for the wire request's `tools[].function.parameters` -- kept as a
   * literal object next to `schema` (never derived from it by reflection) because zod 4's internal
   * shape is not a stable thing to introspect, and every one of this package's tool schemas is small
   * enough that keeping both in sync by hand, side by side in the same file, is the more honest
   * contract than a generic-but-fragile zod-to-JSON-Schema converter would be. */
  parameters: Record<string, unknown>
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | null

export type ChatUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type ChatCompletionResult = {
  content: string | null
  /** Never surfaced to a caller outside this package's own retry logic and token accounting
   * (TECH-SPEC §8: "reasoning_content never shown or stored beyond token counts"). Kept here, not
   * dropped at the wire, only so `run()` can decide whether an empty `content` is a genuine dead end
   * or just "the model spent its budget thinking" before the retry-with-doubled-`max_tokens` path. */
  reasoningContent: string | null
  toolCalls: ToolCall[]
  finishReason: FinishReason
  usage: ChatUsage
}

export type ChatCompletionRequest = {
  model: string
  messages: ChatMessage[]
  maxTokens: number
  tools?: ToolDef[]
  toolChoice?: 'auto' | 'required' | 'none'
  /** v1.1 AI-AUDIT G-2: never left unset for a structured-extraction feature. Two identical
   * quick-adds returning different labels *is* the "feels random" complaint, literally. */
  temperature?: number
  /** v1.1 critique SEV2 #23: the caller's remaining wall-clock budget for THIS attempt, in ms.
   * The provider's own configured `requestTimeoutMs` is a per-attempt ceiling; this is what is left
   * of the whole run, and the provider takes whichever is smaller. Without it a run could spend
   * 6 x 90 s across the doubling retry, the schema retry and each of their transport retries -- the
   * 275 962 ms the head's own trace table recorded. */
  timeoutMs?: number
}

/** The one seam a provider implements -- the real GLM endpoint (`glm-provider.ts`) and the
 * deterministic `MockProvider` (`mock-provider.ts`) are structurally interchangeable, exactly like
 * `apps/api/src/deps.ts`'s `Deps` interface separates route handlers from Postgres. */
export interface AiProvider {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  /** v1.1 SPEC §8 "Honesty": true when the answer is produced by this repo's offline simulator
   * rather than a real model. Carried all the way to `RunMeta.simulated` so the UI can show its
   * amber "Namunaviy javob" strip and suppress a fake model/cost/latency, instead of presenting a
   * canned answer as if a ministry had paid a provider for it. */
  readonly simulated: boolean
}

/**
 * The runnable feature set (v1.1 SPEC §8). Nine prompts absorbed the ten v1.0 ids -- see
 * `LEGACY_AI_FEATURES` below for the two that were merged away -- plus five features the audit
 * recommended adding (§4 "Add": N-1..N-5) and `semantic_ask` for AI L2 (EPIC-016).
 */
export type AiFeature =
  | 'quick_add_parse'
  | 'subtask_breakdown'
  | 'plan_sprint'
  | 'deadline_risk'
  | 'catch_up'
  | 'draft_event'
  | 'summarize_thread'
  | 'nl_analytics'
  | 'translate'
  | 'draft_reply'
  | 'board_risk_digest'
  | 'suggest_assignee'
  | 'duplicate_check'
  | 'semantic_ask'

export const AI_FEATURES: readonly AiFeature[] = [
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
]

/**
 * v1.0 feature ids that no longer have a prompt of their own (AI-AUDIT §4, D-1): `weekly_summary`
 * and `what_did_i_miss` were the same query over the same data at two time windows, and are now one
 * `catch_up` feature with `scope` + `window`. They stay in this list -- and therefore in the API's
 * trace enum and the `/ai` usage table -- because `app.ai_traces` rows written before v1.1 still
 * carry them, and a usage history that 500s on its own past is worse than a merged feature id.
 * Nothing may be *run* under a legacy id: `RUNNABLE` above is the registry's key set.
 */
export type LegacyAiFeature = 'weekly_summary' | 'what_did_i_miss'

export const LEGACY_AI_FEATURES: readonly LegacyAiFeature[] = ['weekly_summary', 'what_did_i_miss']

/** Every feature id that may appear on a trace row: runnable today, plus the merged-away two. */
export const AI_TRACE_FEATURES: readonly (AiFeature | LegacyAiFeature)[] = [
  ...AI_FEATURES,
  ...LEGACY_AI_FEATURES,
]

export type Locale = 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'

/** What every `run()` call reports back to the caller for tracing/budgeting -- token counts and cost
 * only, never prompt/response text (I-1-adjacent guard rail this package adds on its own: a personal-
 * workspace feature like `plan_sprint` must never leave a trace of what someone typed). */
export type RunMeta = {
  feature: AiFeature
  model: string
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  totalTokens: number
  costUzs: number
  latencyMs: number
  retried: boolean
  /** v1.1: the answer came from the offline simulator, not a real provider. */
  simulated: boolean
  /** `schema_invalid_after_retry` also covers a *faithfulness* failure (v1.1: a plan that dropped an
   * item, a summary citing an id nobody gave it) -- `validateOutput` rejects those with the same
   * status rather than inventing a new one, because `app.ai_trace_status` is a Postgres enum and a
   * schema-valid-but-unfaithful answer is, to every consumer of that column, the same thing: the
   * model produced something this gateway refused to hand on. */
  status:
    | 'ok'
    | 'empty_after_retry'
    | 'schema_invalid_after_retry'
    | 'provider_error'
    /** v1.1 critique SEV2 #23: the whole run ran out of the wall-clock budget its caller gave it.
     * Distinct from `provider_error` because it is the one failure a person can act on -- "it took
     * too long, try again" is a different sentence from "the provider refused". */
    | 'timeout'
}

export type RunResult<T> =
  | { ok: true; data: T; meta: RunMeta }
  | { ok: false; error: string; meta: RunMeta }

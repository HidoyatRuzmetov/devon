// Shared shapes for the gateway (TECH-SPEC §8). Deliberately provider-agnostic: everything here is
// the OpenAI-compatible chat-completions shape GLM-5.2 speaks (glm-api-instruction.md), trimmed to
// exactly the fields this codebase reads -- never the full OpenAI SDK surface.
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
 * per feature"). `schema` is both the JSON Schema handed to the API (via `zodToJsonSchemaShape`,
 * kept intentionally small/hand-rolled -- see `json-schema.ts`) and the Zod validator every tool-call
 * argument is checked against before any caller ever sees it. */
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
  temperature?: number
}

/** The one seam a provider implements -- the real GLM endpoint (`glm-provider.ts`) and the
 * deterministic `MockProvider` (`mock-provider.ts`) are structurally interchangeable, exactly like
 * `apps/api/src/deps.ts`'s `Deps` interface separates route handlers from Postgres. */
export interface AiProvider {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>
}

export type AiFeature =
  | 'quick_add_parse'
  | 'subtask_breakdown'
  | 'plan_sprint'
  | 'deadline_risk'
  | 'weekly_summary'
  | 'draft_event'
  | 'summarize_thread'
  | 'nl_analytics'
  | 'translate'
  | 'what_did_i_miss'

export const AI_FEATURES: readonly AiFeature[] = [
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
  status: 'ok' | 'empty_after_retry' | 'schema_invalid_after_retry' | 'provider_error'
}

export type RunResult<T> =
  | { ok: true; data: T; meta: RunMeta }
  | { ok: false; error: string; meta: RunMeta }

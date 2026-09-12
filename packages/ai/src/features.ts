// The feature registry (TECH-SPEC §8, v1.1 SPEC §8): aggregates every `src/prompts/<feature>.ts`
// into one lookup table, and provides the three things generic across every feature -- `runFeature`
// (the typed, validated call a caller actually makes), `buildOfflineRespond` (wires every feature's
// own `simulate()` into a single `MockProvider` respond function for "no key configured"), and the
// two cross-cutting post-processing rules v1.1 added:
//
//   1. `validateOutput` -- the per-feature faithfulness gate, handed to `run()` so the retry lives in
//      the gateway instead of being re-implemented fourteen times (AI-AUDIT §5 fix 6);
//   2. Uzbek Latin orthography normalisation over every string the model produced, before any caller
//      ever sees it (AI-AUDIT §5 fix 10) -- a model that writes `o'zgarish` instead of `oʻzgarish`
//      is producing text no Uzbek reader considers correct, and the fix is mechanical.
import { z } from 'zod'
import type { AiConfig } from './config.js'
import { run } from './gateway.js'
import type { FeatureSpec } from './feature-spec.js'
import { boardRiskDigestSpec } from './prompts/board-risk-digest.js'
import { catchUpSpec } from './prompts/catch-up.js'
import { deadlineRiskSpec } from './prompts/deadline-risk.js'
import { draftEventSpec } from './prompts/draft-event.js'
import { draftReplySpec } from './prompts/draft-reply.js'
import { duplicateCheckSpec } from './prompts/duplicate-check.js'
import { nlAnalyticsSpec } from './prompts/nl-analytics.js'
import { planSprintSpec } from './prompts/plan-sprint.js'
import { quickAddParseSpec } from './prompts/quick-add-parse.js'
import { semanticAskSpec } from './prompts/semantic-ask.js'
import { subtaskBreakdownSpec } from './prompts/subtask-breakdown.js'
import { suggestAssigneeSpec } from './prompts/suggest-assignee.js'
import { summarizeThreadSpec } from './prompts/summarize-thread.js'
import { translateSpec } from './prompts/translate.js'
import { normalizeUzLatnDeep } from './uz.js'
import type {
  AiFeature,
  AiProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  Locale,
  RunResult,
} from './types.js'

// A registry of fourteen structurally different `FeatureSpec<TIn, TOut>` instances has no single
// non-`any` element type; every actual use site below (`runFeature`, `buildOfflineRespond`) is fully
// typed at its own boundary instead (input validated through `inputSchema`, output typed by the
// caller's own generic parameter).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeatureSpec = FeatureSpec<any, any>

const REGISTRY: Record<AiFeature, AnyFeatureSpec> = {
  quick_add_parse: quickAddParseSpec,
  subtask_breakdown: subtaskBreakdownSpec,
  plan_sprint: planSprintSpec,
  deadline_risk: deadlineRiskSpec,
  catch_up: catchUpSpec,
  draft_event: draftEventSpec,
  summarize_thread: summarizeThreadSpec,
  nl_analytics: nlAnalyticsSpec,
  translate: translateSpec,
  draft_reply: draftReplySpec,
  board_risk_digest: boardRiskDigestSpec,
  suggest_assignee: suggestAssigneeSpec,
  duplicate_check: duplicateCheckSpec,
  semantic_ask: semanticAskSpec,
}

const BY_TOOL_NAME = new Map(Object.values(REGISTRY).map((spec) => [spec.toolName, spec]))

export function getFeatureSpec(feature: AiFeature): FeatureSpec<{ locale: Locale }, unknown> {
  return REGISTRY[feature]
}

export type RunFeatureOptions = {
  provider: AiProvider
  config: AiConfig
  feature: AiFeature
  /** Raw, not-yet-validated caller input -- `runFeature` validates it against the feature's own
   * `inputSchema` before ever building a message, exactly like every Fastify route in this codebase
   * validates `req.body` before a handler sees it. */
  input: unknown
  /** Optional extra history *before* the feature's own single user message -- no feature in this
   * package uses this today (see `trim.ts`'s header comment on the multi-turn future). */
  priorMessages?: ChatMessage[]
}

export type RunFeatureResult<T> = RunResult<T> | { ok: false; error: string; meta: null }

export async function runFeature<T = unknown>(
  options: RunFeatureOptions,
): Promise<RunFeatureResult<T>> {
  const spec = REGISTRY[options.feature]
  const parsedInput = spec.inputSchema.safeParse(options.input)
  if (!parsedInput.success) {
    return { ok: false, error: z.prettifyError(parsedInput.error), meta: null }
  }
  const input = parsedInput.data as { locale: Locale }

  const messages: ChatMessage[] = [
    { role: 'system', content: spec.systemPrompt(input) },
    ...(options.priorMessages ?? []),
    { role: 'user', content: spec.buildUserContent(input) },
  ]

  const result = await run<T>({
    provider: options.provider,
    config: options.config,
    feature: options.feature,
    messages,
    tool: {
      name: spec.toolName,
      description: spec.toolDescription,
      schema: spec.outputSchema,
      parameters: spec.parameters,
    },
    maxTokens: spec.defaultMaxTokens,
    temperature: spec.temperature,
    ...(spec.validateOutput
      ? {
          validate: (output: T) =>
            spec.validateOutput!(input, output) as
              | { ok: true; output: T }
              | { ok: false; error: string },
        }
      : {}),
  })

  if (!result.ok) return result
  // Orthography is the last thing that happens, after validation and after any repair: every string
  // a caller receives has been through it, and no id ever has (see `uz.ts`'s `ID_BEARING_KEY`).
  return input.locale === 'uz-Latn' ? { ...result, data: normalizeUzLatnDeep(result.data) } : result
}

function lastUserContent(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return messages[i]!.content
  }
  return null
}

/**
 * Builds the `respond` function for a `MockProvider` used as the production/demo "no key configured"
 * fallback (`config.ts`'s `hasApiKey`): looks at which tool the request was forced to call, recovers
 * the typed input by parsing the request's own user-message JSON back through that feature's
 * `inputSchema`, and returns that feature's `simulate()` output wrapped as a tool call -- so `run()`
 * upstream sees a completely ordinary, schema-valid answer and the rest of the pipeline (tracing,
 * budget accounting, `validateOutput`, orthography) behaves identically whether the answer came from
 * GLM or from here. That last point is the reason the guard rails are tested at all: the offline
 * path is exactly where an unexercised check rots.
 */
export function buildOfflineRespond(): (request: ChatCompletionRequest) => ChatCompletionResult {
  return (request) => {
    const toolName = request.tools?.[0]?.name
    const spec = toolName ? BY_TOOL_NAME.get(toolName) : undefined
    const rawContent = lastUserContent(request.messages)
    const empty: ChatCompletionResult = {
      content: null,
      reasoningContent: null,
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }
    if (!spec || !rawContent) return empty

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawContent)
    } catch {
      return empty
    }
    const parsedInput = spec.inputSchema.safeParse(parsedJson)
    if (!parsedInput.success) return empty

    const output = spec.simulate(parsedInput.data)
    const argumentsJson = JSON.stringify(output)
    // A rough token estimate so the offline path still produces plausible-looking numbers in traces
    // instead of always reading zero (`trim.ts`'s ~4-chars/token heuristic, reused here). The UI
    // never shows these as a cost: `RunMeta.simulated` tells it not to.
    const promptTokens = Math.ceil(rawContent.length / 4)
    const completionTokens = Math.ceil(argumentsJson.length / 4)
    return {
      content: null,
      reasoningContent: null,
      toolCalls: [{ id: 'offline-1', name: spec.toolName, argumentsJson }],
      finishReason: 'tool_calls',
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    }
  }
}

export { REGISTRY as FEATURE_REGISTRY }

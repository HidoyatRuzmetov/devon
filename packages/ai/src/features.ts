// The feature registry (TECH-SPEC §8): aggregates every `src/prompts/<feature>.ts` into one lookup
// table, and provides the two functions generic across every feature -- `runFeature` (the typed,
// validated call a caller actually makes) and `buildOfflineRespond` (wires every feature's own
// `simulate()` into a single `MockProvider` respond function for "no key configured").
import { z } from 'zod'
import type { AiConfig } from './config.js'
import { run } from './gateway.js'
import type { FeatureSpec } from './feature-spec.js'
import { deadlineRiskSpec } from './prompts/deadline-risk.js'
import { draftEventSpec } from './prompts/draft-event.js'
import { nlAnalyticsSpec } from './prompts/nl-analytics.js'
import { planSprintSpec } from './prompts/plan-sprint.js'
import { quickAddParseSpec } from './prompts/quick-add-parse.js'
import { subtaskBreakdownSpec } from './prompts/subtask-breakdown.js'
import { summarizeThreadSpec } from './prompts/summarize-thread.js'
import { translateSpec } from './prompts/translate.js'
import { weeklySummarySpec } from './prompts/weekly-summary.js'
import { whatDidIMissSpec } from './prompts/what-did-i-miss.js'
import type {
  AiFeature,
  AiProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  Locale,
  RunResult,
} from './types.js'

// A registry of ten structurally different `FeatureSpec<TIn, TOut>` instances has no single non-`any`
// element type; every actual use site below (`runFeature`, `buildOfflineRespond`) is fully typed at
// its own boundary instead (input validated through `inputSchema`, output typed by the caller's own
// generic parameter).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeatureSpec = FeatureSpec<any, any>

const REGISTRY: Record<AiFeature, AnyFeatureSpec> = {
  quick_add_parse: quickAddParseSpec,
  subtask_breakdown: subtaskBreakdownSpec,
  plan_sprint: planSprintSpec,
  deadline_risk: deadlineRiskSpec,
  weekly_summary: weeklySummarySpec,
  draft_event: draftEventSpec,
  summarize_thread: summarizeThreadSpec,
  nl_analytics: nlAnalyticsSpec,
  translate: translateSpec,
  what_did_i_miss: whatDidIMissSpec,
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

  const messages: ChatMessage[] = [
    { role: 'system', content: spec.systemPrompt(parsedInput.data) },
    ...(options.priorMessages ?? []),
    { role: 'user', content: spec.buildUserContent(parsedInput.data) },
  ]

  return run<T>({
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
  })
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
 * budget accounting) behaves identically whether the answer came from GLM or from here.
 */
export function buildOfflineRespond(): (request: ChatCompletionRequest) => ChatCompletionResult {
  return (request) => {
    const toolName = request.tools?.[0]?.name
    const spec = toolName ? BY_TOOL_NAME.get(toolName) : undefined
    const rawContent = lastUserContent(request.messages)
    if (!spec || !rawContent) {
      return {
        content: null,
        reasoningContent: null,
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }
    }
    const parsedInput = spec.inputSchema.safeParse(JSON.parse(rawContent))
    if (!parsedInput.success) {
      return {
        content: null,
        reasoningContent: null,
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }
    }
    const output = spec.simulate(parsedInput.data)
    const argumentsJson = JSON.stringify(output)
    // A rough token estimate so the demo/offline path still produces plausible-looking cost/latency
    // in traces instead of always reading zero (`trim.ts`'s ~4-chars/token heuristic, reused here).
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

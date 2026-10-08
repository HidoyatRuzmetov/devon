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
import { estimateTokens } from './trim.js'
import { tokensToCostUzs } from './budget.js'
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

/**
 * v1.1 critique SEV3 #30 -- "five of the thirteen helpers show no price at all, and the eight that
 * do show a bare figure with no unit of measure".
 *
 * The eight that showed something were showing *this month's spend*, which is why a helper nobody
 * had run yet showed nothing: a spend of zero is not a price. What a head opening `/ai` actually
 * wants is "what does one call of this cost", and that is knowable before anybody runs it, from the
 * feature's own declared shape.
 *
 * The estimate is deliberately built only out of what a `FeatureSpec` states about itself and never
 * out of a live call:
 *
 *   * the **tool schema** and its description -- sent verbatim on every call of this feature, and
 *     the single largest static part of the request (`catch_up`'s is by far the biggest in the
 *     product, which is exactly why it should read as the most expensive helper);
 *   * the **few-shot examples and instructions** carried in the system prompt, approximated by the
 *     spec's own `defaultMaxTokens` floor below;
 *   * the **completion budget** (`defaultMaxTokens`), the ceiling on what comes back.
 *
 * So it is an upper-ish bound on one call, honest about being an estimate ("~30 soʻm / soʻrov"), and
 * it moves when a prompt is rewritten -- which is the property that makes it worth showing at all.
 * The department's real per-feature spend is still rendered separately; the two answer different
 * questions.
 */
export function estimatedTokensPerCall(feature: AiFeature): number {
  const spec = REGISTRY[feature]
  const schema = estimateTokens(JSON.stringify(spec.parameters))
  const description = estimateTokens(spec.toolDescription)
  // The system prompt is built from the caller's input, so it cannot be measured without one. This
  // floor is the part that does not vary: the role sentence, the constraint block and the few-shot
  // examples every `composePrompt` emits.
  const promptFloor = 600
  return schema + description + promptFloor + spec.defaultMaxTokens
}

/** The same estimate in soʻm, at the configured per-million price. */
export function estimatedCostUzsPerCall(feature: AiFeature, pricePerMillionUzs?: number): number {
  return tokensToCostUzs(estimatedTokensPerCall(feature), pricePerMillionUzs)
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
  /** v1.1 critique SEV2 #23: the whole run's wall-clock budget. Falls back to the feature's own
   * `DEFAULT_FEATURE_TIMEOUT_MS` below, which is the number a person is actually asked to wait. */
  overallTimeoutMs?: number
}

/**
 * v1.1 critique SEV2 #23 -- how long anybody is asked to wait for one helper.
 *
 * The head's own trace table recorded 112 123 ms, 129 203 ms and 275 962 ms against the real GLM,
 * because `config.requestTimeoutMs` bounds one HTTP attempt and a run can make up to six of them.
 * This is the run-level ceiling, and it is chosen per feature by how long the answer is worth
 * waiting for at the surface it appears on: an inline quick-add parse has to feel instant or it is
 * useless, and a Monday briefing the head deliberately pressed a button for may take a minute --
 * but not four.
 */
export const DEFAULT_FEATURE_TIMEOUT_MS: Record<AiFeature, number> = {
  // Typed into a field, blocking the person mid-sentence.
  quick_add_parse: 20_000,
  translate: 20_000,
  duplicate_check: 20_000,
  // A panel the person opened and is watching.
  subtask_breakdown: 45_000,
  deadline_risk: 45_000,
  draft_reply: 45_000,
  suggest_assignee: 45_000,
  summarize_thread: 45_000,
  nl_analytics: 45_000,
  semantic_ask: 45_000,
  draft_event: 60_000,
  // The long-form, deliberately-requested ones. 75 s is under the "bir daqiqagacha" the pending
  // panel promises plus a little slack, and far under anything that reads as a hang.
  plan_sprint: 75_000,
  board_risk_digest: 75_000,
  // `catch_up` is not one of those, and pretending it was is what broke it. v1.1 recapture report
  // §1a #23: the department briefing measured 78.8 s, 112 s and 275.9 s against the ministry's GLM
  // on one afternoon -- it has never once completed under 78 s -- so a 75 s budget did not make it
  // faster, it made every run end in "AI did not answer in time". A hang became a guaranteed
  // failure.
  //
  // 300 s is the measured worst case plus headroom, and it is safe to spend *because nobody waits
  // on it any more*: `apps/api/src/modules/ai/briefing.ts` runs this feature in a pg-boss job and
  // the head's tile reads the cached result (`app.ai_briefings`). The number below is a server-side
  // job budget, not a request budget -- which is the only kind of budget a four-minute reasoning
  // call can honestly have.
  catch_up: 300_000,
}

export type RunFeatureResult<T> = RunResult<T> | { ok: false; error: string; meta: null }

/**
 * Appended to every feature's system prompt, because it is a fact about the *provider*, not about any
 * one feature -- and a rule stated fourteen times is a rule that drifts thirteen ways.
 *
 * Measured against the configured `glm-5.2` (v1.1 integration): with `tool_choice: "required"` it
 * deliberates at length and then emits the SAME tool call over and over until it hits `max_tokens`,
 * so `finish_reason` is always `"length"`, the gateway's "answer was cut off, double the budget"
 * branch fires on a perfectly good answer, and one department briefing cost 32 000 tokens across
 * four minutes. One call, then stop, is all this asks for.
 */
const CALL_ONCE_RULE =
  'Call the tool exactly once, then stop. Do not repeat the call, do not emit a second one, and do ' +
  'not write any prose outside it. Decide quickly: a short deliberation followed by the call is ' +
  'better than a long one, and the budget you think in is the same budget the answer is written from.'

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
    {
      role: 'system',
      content: `${spec.systemPrompt(input)}

${CALL_ONCE_RULE}`,
    },
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
    overallTimeoutMs: options.overallTimeoutMs ?? DEFAULT_FEATURE_TIMEOUT_MS[options.feature],
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
  // Translation has a separate target language and byte-preserved names/codes. Its validator
  // normalizes only target-language prose; the reader's UI language must never rewrite it.
  return input.locale === 'uz-Latn' && options.feature !== 'translate'
    ? { ...result, data: normalizeUzLatnDeep(result.data) }
    : result
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

// The one `run()` every feature calls (TECH-SPEC §8, v1.1 SPEC §8 "Gateway"). Orchestrates, in
// order: history trimming, the provider call, the "answer truncated -> retry with doubled
// max_tokens" rule, tool-call extraction, Zod validation with exactly one retry carrying the
// validation error back to the model, an optional feature-specific faithfulness check that may also
// buy one retry, and cost/latency accounting. Nothing above this file ever talks to `AiProvider`
// directly (`features.ts` and the API module only ever call `run()`).
//
// v1.1 fixes carried here, from AI-AUDIT §2.2:
//   G-1 a *truncated tool call* (finish_reason 'length' with unparseable arguments) now also
//       doubles max_tokens, instead of burning the schema retry at the same budget and billing twice.
//   G-2 `temperature` is always sent. Ten structured-extraction tasks on a provider's default
//       sampling is precisely the "two identical quick-adds give different labels" complaint.
//   G-6 the schema-retry's tool message is keyed to the tool call that actually matched, not
//       `toolCalls[0]`.
import { z } from 'zod'
import { tokensToCostUzs } from './budget.js'
import type { AiConfig } from './config.js'
import { trimHistory } from './trim.js'
import type {
  AiFeature,
  AiProvider,
  ChatMessage,
  RunMeta,
  RunResult,
  ToolCall,
  ToolDef,
} from './types.js'

export type RunOptions<T> = {
  provider: AiProvider
  config: AiConfig
  feature: AiFeature
  messages: ChatMessage[]
  tool: ToolDef<T>
  /** Defaults to `config.minMaxTokens` (>= 1024, TECH-SPEC §8) -- a caller may ask for more up front
   * for a feature it knows tends to reason longer (a Monday briefing), never less. */
  maxTokens?: number
  /** v1.1 G-2. Always supplied by `features.ts` from the feature's own spec; defaulted here only so
   * a direct `run()` call in a unit test does not have to think about sampling. */
  temperature?: number
  /**
   * Feature-specific faithfulness check, run after Zod accepts the shape. Returning an error buys
   * exactly one extra round trip carrying that reason back to the model, then fails the run --
   * `features.ts` passes its spec's `validateOutput` through here so the retry loop lives in one
   * place rather than being re-implemented per feature.
   */
  validate?: (output: T) => { ok: true; output: T } | { ok: false; error: string }
}

function findToolCall(toolCalls: readonly ToolCall[], name: string): ToolCall | null {
  return toolCalls.find((call) => call.name === name) ?? null
}

type Extraction =
  | { kind: 'ok'; value: unknown }
  /** A tool call arrived but its `arguments` were not parseable JSON -- the fingerprint of a reply
   * the provider cut off mid-object (G-1). Distinct from "nothing arrived at all". */
  | { kind: 'unparseable' }
  | { kind: 'absent' }

/** Tries the model's tool call first (the intended path); falls back to parsing `content` as JSON --
 * some smaller/quantised OpenAI-compatible deployments answer a forced single-tool request in
 * `content` instead of `tool_calls` under load, and refusing to even look is a worse failure mode
 * than being lenient about where the JSON came from. */
function extractArguments(
  toolCalls: readonly ToolCall[],
  toolName: string,
  content: string | null,
): Extraction {
  const call = findToolCall(toolCalls, toolName)
  if (call) {
    try {
      return { kind: 'ok', value: JSON.parse(call.argumentsJson) }
    } catch {
      return { kind: 'unparseable' }
    }
  }
  if (content && content.trim().length > 0) {
    try {
      return { kind: 'ok', value: JSON.parse(content) }
    } catch {
      return { kind: 'unparseable' }
    }
  }
  return { kind: 'absent' }
}

export async function run<T>(options: RunOptions<T>): Promise<RunResult<T>> {
  const { provider, config, feature, tool } = options
  const requestedMaxTokens = Math.max(options.maxTokens ?? config.minMaxTokens, config.minMaxTokens)
  const temperature = options.temperature ?? config.defaultTemperature
  const simulated = provider.simulated
  const start = Date.now()

  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  let retried = false

  const marginForReply = requestedMaxTokens * 2 // room for a possible doubled retry, kept out of history
  const messages = trimHistory(options.messages, config.contextWindowTokens - marginForReply)

  let maxTokens = requestedMaxTokens
  let lastContent: string | null = null
  let lastToolCalls: ToolCall[] = []
  let extraction: Extraction = { kind: 'absent' }

  const finish = (status: RunMeta['status']): RunMeta => ({
    feature,
    model: config.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    // GLM bills reasoning inside `completion_tokens` and never reports it separately, so this can
    // only ever be 0 here -- TECH-SPEC §8 forbids storing the text anyway (AI-AUDIT G-3: the honest
    // answer to "why did a 40-word summary cost 2100 tokens?" is this comment, not a fabricated
    // split of a number the provider does not give us).
    reasoningTokens: 0,
    totalTokens: usage.totalTokens,
    costUzs: tokensToCostUzs(usage.totalTokens, config.pricePerMillionTokensUzs),
    latencyMs: Date.now() - start,
    retried,
    simulated,
    status,
  })

  // -- Step 1: call the model, doubling max_tokens once if the answer was cut off -- either because
  // reasoning ate the whole budget (empty reply, glm-api-instruction.md point 1) or because the tool
  // call itself was truncated mid-JSON (v1.1 G-1). ---------------------------------------------------
  for (let attempt = 0; attempt < 2; attempt++) {
    let result
    try {
      result = await provider.complete({
        model: config.model,
        messages,
        maxTokens,
        tools: [tool],
        toolChoice: 'required',
        temperature,
      })
    } catch (err) {
      const meta = finish('provider_error')
      return { ok: false, error: err instanceof Error ? err.message : String(err), meta }
    }

    usage.promptTokens += result.usage.promptTokens
    usage.completionTokens += result.usage.completionTokens
    usage.totalTokens += result.usage.totalTokens
    lastContent = result.content
    lastToolCalls = result.toolCalls
    extraction = extractArguments(result.toolCalls, tool.name, result.content)

    const cameBackEmpty =
      (result.content === null || result.content.trim().length === 0) &&
      result.toolCalls.length === 0
    const truncatedMidAnswer = extraction.kind === 'unparseable'
    const worthMoreTokens = cameBackEmpty || truncatedMidAnswer

    if (
      worthMoreTokens &&
      result.finishReason === 'length' &&
      attempt === 0 &&
      maxTokens < config.maxMaxTokens
    ) {
      maxTokens = Math.min(maxTokens * 2, config.maxMaxTokens)
      retried = true
      continue
    }
    break
  }

  if (extraction.kind === 'absent' && lastToolCalls.length === 0) {
    return {
      ok: false,
      error: 'The model returned no content after a retry with more tokens.',
      meta: finish('empty_after_retry'),
    }
  }

  // -- Step 2: validate the tool call's arguments against the feature's Zod schema, then against the
  // feature's own faithfulness rule. Exactly one corrective round trip is spent across the two
  // (TECH-SPEC §8: "one retry with the error"): a model that both mis-shapes and misattributes on the
  // same answer does not get two chances to bill the department. -------------------------------------
  const judge = (candidate: unknown): { problem: string } | { problem: null; output: T } => {
    const result = tool.schema.safeParse(candidate)
    if (!result.success) return { problem: z.prettifyError(result.error) }
    if (!options.validate) return { problem: null, output: result.data }
    const verdict = options.validate(result.data)
    return verdict.ok ? { problem: null, output: verdict.output } : { problem: verdict.error }
  }

  let judged = judge(extraction.kind === 'ok' ? extraction.value : undefined)

  if (judged.problem !== null) {
    const problem = judged.problem
    const matchedCall = findToolCall(lastToolCalls, tool.name) ?? lastToolCalls[0] ?? null
    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: lastContent,
        ...(lastToolCalls.length > 0 ? { toolCalls: lastToolCalls } : {}),
      },
      {
        role: matchedCall ? 'tool' : 'user',
        content: `Your previous answer was rejected. Reason:\n${problem}\n\nCall "${tool.name}" again with corrected arguments. Fix only what the reason names; keep everything else identical.`,
        // v1.1 G-6: key the tool result to the call this tool actually matched, not blindly to
        // `toolCalls[0]` -- harmless with one tool per feature, a silent mis-attribution the moment
        // a feature ever exposes two.
        ...(matchedCall ? { toolCallId: matchedCall.id } : {}),
      },
    ]

    let retryResult
    try {
      retryResult = await provider.complete({
        model: config.model,
        messages: retryMessages,
        maxTokens,
        tools: [tool],
        toolChoice: 'required',
        temperature,
      })
    } catch (err) {
      retried = true
      const meta = finish('provider_error')
      return { ok: false, error: err instanceof Error ? err.message : String(err), meta }
    }

    usage.promptTokens += retryResult.usage.promptTokens
    usage.completionTokens += retryResult.usage.completionTokens
    usage.totalTokens += retryResult.usage.totalTokens
    retried = true

    const retryExtraction = extractArguments(retryResult.toolCalls, tool.name, retryResult.content)
    judged = judge(retryExtraction.kind === 'ok' ? retryExtraction.value : undefined)
  }

  if (judged.problem !== null) {
    return {
      ok: false,
      error: judged.problem,
      meta: finish('schema_invalid_after_retry'),
    }
  }

  return { ok: true, data: judged.output, meta: finish('ok') }
}

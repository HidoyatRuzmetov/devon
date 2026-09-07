// The one `run()` every feature calls (TECH-SPEC §8). Orchestrates, in order: history trimming,
// the provider call, the "empty content + finish_reason length -> retry with doubled max_tokens"
// rule, tool-call extraction, Zod validation with exactly one retry carrying the validation error
// back to the model, and cost/latency accounting. Nothing above this file ever talks to `AiProvider`
// directly (`features.ts`/the API module only ever call `run()`).
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
   * for a feature it knows tends to reason longer (e.g. weekly summaries), never less. */
  maxTokens?: number
}

function emptyUsageMeta(feature: AiFeature, model: string): RunMeta {
  return {
    feature,
    model,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUzs: 0,
    latencyMs: 0,
    retried: false,
    status: 'ok',
  }
}

function findToolCall(toolCalls: readonly ToolCall[], name: string): ToolCall | null {
  return toolCalls.find((call) => call.name === name) ?? null
}

/** Tries the model's tool call first (the intended path); falls back to parsing `content` as JSON --
 * some smaller/quantised OpenAI-compatible deployments answer a forced single-tool request in
 * `content` instead of `tool_calls` under load, and refusing to even look is a worse failure mode
 * than being lenient about where the JSON came from. */
function extractArguments(
  toolCalls: readonly ToolCall[],
  toolName: string,
  content: string | null,
): unknown | undefined {
  const call = findToolCall(toolCalls, toolName)
  if (call) {
    try {
      return JSON.parse(call.argumentsJson)
    } catch {
      return undefined
    }
  }
  if (content) {
    try {
      return JSON.parse(content)
    } catch {
      return undefined
    }
  }
  return undefined
}

export async function run<T>(options: RunOptions<T>): Promise<RunResult<T>> {
  const { provider, config, feature, tool } = options
  const requestedMaxTokens = Math.max(options.maxTokens ?? config.minMaxTokens, config.minMaxTokens)
  const start = Date.now()

  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  let retried = false

  const marginForReply = requestedMaxTokens * 2 // room for a possible doubled retry, kept out of history
  const messages = trimHistory(options.messages, config.contextWindowTokens - marginForReply)

  let maxTokens = requestedMaxTokens
  let lastContent: string | null = null
  let lastToolCalls: ToolCall[] = []

  // -- Step 1: call the model, doubling max_tokens once if it came back empty because reasoning ate
  // the whole budget (TECH-SPEC §8 / glm-api-instruction.md point 1). --------------------------------
  for (let attempt = 0; attempt < 2; attempt++) {
    let result
    try {
      result = await provider.complete({
        model: config.model,
        messages,
        maxTokens,
        tools: [tool],
        toolChoice: 'required',
      })
    } catch (err) {
      const meta = emptyUsageMeta(feature, config.model)
      meta.latencyMs = Date.now() - start
      meta.status = 'provider_error'
      return { ok: false, error: err instanceof Error ? err.message : String(err), meta }
    }

    usage.promptTokens += result.usage.promptTokens
    usage.completionTokens += result.usage.completionTokens
    usage.totalTokens += result.usage.totalTokens
    lastContent = result.content
    lastToolCalls = result.toolCalls

    const cameBackEmpty =
      (result.content === null || result.content.trim().length === 0) &&
      result.toolCalls.length === 0
    if (
      cameBackEmpty &&
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

  if (lastToolCalls.length === 0 && (!lastContent || lastContent.trim().length === 0)) {
    const meta = emptyUsageMeta(feature, config.model)
    meta.promptTokens = usage.promptTokens
    meta.completionTokens = usage.completionTokens
    meta.totalTokens = usage.totalTokens
    meta.costUzs = tokensToCostUzs(usage.totalTokens, config.pricePerMillionTokensUzs)
    meta.latencyMs = Date.now() - start
    meta.retried = retried
    meta.status = 'empty_after_retry'
    return {
      ok: false,
      error: 'The model returned no content after a retry with more tokens.',
      meta,
    }
  }

  // -- Step 2: validate the tool call's arguments against the feature's Zod schema, one retry with
  // the validation error appended to history (TECH-SPEC §8: "one retry with the error"). -------------
  let raw = extractArguments(lastToolCalls, tool.name, lastContent)
  let parsed = tool.schema.safeParse(raw)

  if (!parsed.success) {
    const errorSummary = z.prettifyError(parsed.error)
    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: lastContent,
        ...(lastToolCalls.length > 0 ? { toolCalls: lastToolCalls } : {}),
      },
      {
        role: lastToolCalls.length > 0 ? 'tool' : 'user',
        content: `Your previous answer did not match the required schema for "${tool.name}". Validation errors:\n${errorSummary}\n\nCall "${tool.name}" again with corrected arguments that satisfy the schema exactly.`,
        ...(lastToolCalls.length > 0 ? { toolCallId: lastToolCalls[0]!.id } : {}),
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
      })
    } catch (err) {
      const meta = emptyUsageMeta(feature, config.model)
      meta.promptTokens = usage.promptTokens
      meta.completionTokens = usage.completionTokens
      meta.totalTokens = usage.totalTokens
      meta.costUzs = tokensToCostUzs(usage.totalTokens, config.pricePerMillionTokensUzs)
      meta.latencyMs = Date.now() - start
      meta.retried = true
      meta.status = 'provider_error'
      return { ok: false, error: err instanceof Error ? err.message : String(err), meta }
    }

    usage.promptTokens += retryResult.usage.promptTokens
    usage.completionTokens += retryResult.usage.completionTokens
    usage.totalTokens += retryResult.usage.totalTokens
    retried = true

    raw = extractArguments(retryResult.toolCalls, tool.name, retryResult.content)
    parsed = tool.schema.safeParse(raw)
  }

  const meta: RunMeta = {
    feature,
    model: config.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: 0, // never reconstructable from usage alone; TECH-SPEC §8 forbids storing it anyway.
    totalTokens: usage.totalTokens,
    costUzs: tokensToCostUzs(usage.totalTokens, config.pricePerMillionTokensUzs),
    latencyMs: Date.now() - start,
    retried,
    status: parsed.success ? 'ok' : 'schema_invalid_after_retry',
  }

  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error), meta }
  }
  return { ok: true, data: parsed.data, meta }
}

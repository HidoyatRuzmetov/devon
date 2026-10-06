// The real provider: an OpenAI-compatible `POST {baseUrl}/chat/completions` against GLM-5.2
// (glm-api-instruction.md, TECH-SPEC §8). Every field this file reads/writes is named exactly as the
// wire protocol names it (snake_case) up to this boundary -- `gateway.ts` and everything above it only
// ever sees this package's own camelCase `types.ts` shapes.
import type {
  AiProvider,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatUsage,
  FinishReason,
  ToolCall,
} from './types.js'

type WireToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type WireMessage = {
  role: ChatMessage['role']
  content: string | null
  tool_call_id?: string
  tool_calls?: WireToolCall[]
}

type WireResponse = {
  choices: Array<{
    message: {
      content: string | null
      reasoning_content?: string | null
      tool_calls?: WireToolCall[]
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function toWireMessage(message: ChatMessage): WireMessage {
  const wire: WireMessage = { role: message.role, content: message.content }
  if (message.toolCallId) wire.tool_call_id = message.toolCallId
  if (message.toolCalls && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.argumentsJson },
    }))
  }
  return wire
}

function toFinishReason(raw: string | null): FinishReason {
  if (raw === 'stop' || raw === 'length' || raw === 'tool_calls' || raw === 'content_filter') {
    return raw
  }
  return null
}

export type GlmProviderOptions = {
  baseUrl: string
  apiKey: string
  requestTimeoutMs: number
  /** Shared retry budget for transport failures and transient HTTP 429/503 responses. The option
   * name remains compatible with existing callers. Defaults to one retry total; zero disables
   * retries. All attempts, backoff and body reads share the original request deadline. */
  maxTransportRetries?: number
  fetchImpl?: typeof fetch
}

function retryDelayMs(header: string | null, attempt: number): number {
  if (header?.trim()) {
    const value = header.trim()
    const seconds = Number(value)
    if (Number.isFinite(seconds)) {
      if (seconds >= 0) return seconds * 1000
    } else {
      const date = Date.parse(value)
      if (Number.isFinite(date)) return Math.max(0, date - Date.now())
    }
  }
  // Missing/invalid Retry-After: avoid immediately hammering an overloaded provider.
  return Math.min(1000 * 2 ** attempt, 5000)
}

export class GlmProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'GlmProviderError'
  }
}

export class GlmProvider implements AiProvider {
  /** v1.1 SPEC §8 "Honesty": a real endpoint, so every answer is a real model's. */
  public readonly simulated = false
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly requestTimeoutMs: number
  private readonly maxTransportRetries: number
  private readonly fetchImpl: typeof fetch

  constructor(options: GlmProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.requestTimeoutMs = options.requestTimeoutMs
    this.maxTransportRetries = options.maxTransportRetries ?? 1
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const body = {
      model: request.model,
      messages: request.messages.map(toWireMessage),
      max_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: request.toolChoice ?? 'auto',
          }
        : {}),
    }

    // One deadline covers transport retries AND reading the response body. Fetch resolves on
    // headers, so clearing its timer there leaves a stalled JSON body unbounded.
    const deadline = Date.now() + (request.timeoutMs ?? this.requestTimeoutMs)
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxTransportRetries; attempt++) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw new GlmProviderError('GLM request timed out')
      const controller = new AbortController()
      // SEV2 #23: whichever is tighter -- this deployment's configured per-attempt ceiling, or what
      // the caller has left of the run's whole budget.
      const attemptTimeoutMs = Math.min(remainingMs, this.requestTimeoutMs)
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs)
      try {
        // nosemgrep: query-in-loop -- bounded transport retry; each attempt depends on the previous failure and shares one deadline.
        const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!res.ok) {
          // Provider bodies may echo prompts or credentials. Status is enough to diagnose the
          // failure; never propagate that untrusted body into API logs or user-facing errors.
          const failure = new GlmProviderError(
            `GLM request failed with status ${res.status}`,
            res.status,
          )
          // Cancel the unread error stream; it is not needed for retry decisions or diagnostics.
          void res.body?.cancel().catch(() => {})
          if ((res.status === 429 || res.status === 503) && attempt < this.maxTransportRetries) {
            const delayMs = retryDelayMs(res.headers.get('retry-after'), attempt)
            // Never shorten a provider's requested wait to fit our budget: refuse instead of
            // retrying too early. Leave time for a new attempt, which checks the deadline again.
            if (delayMs >= deadline - Date.now()) throw failure
            controller.abort()
            clearTimeout(timer)
            // nosemgrep: query-in-loop -- Retry-After wait depends on this response and shares the same bounded attempt count/deadline.
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
            continue
          }
          throw failure
        }

        // nosemgrep: query-in-loop -- reads this attempt's response before deciding whether a sequential retry is needed.
        const parsed = (await res.json()) as WireResponse
        const choice = parsed.choices[0]
        if (!choice) throw new GlmProviderError('GLM response had no choices')

        const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          argumentsJson: call.function.arguments,
        }))

        const usage: ChatUsage = {
          promptTokens: parsed.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.usage?.completion_tokens ?? 0,
          totalTokens: parsed.usage?.total_tokens ?? 0,
        }

        return {
          content: choice.message.content ?? null,
          reasoningContent: choice.message.reasoning_content ?? null,
          toolCalls,
          finishReason: toFinishReason(choice.finish_reason),
          usage,
        }
      } catch (err) {
        lastError = err
        // Eligible 429/503 responses are handled above. Authentication, other HTTP errors and
        // malformed provider choices never retry; transport failures use the remaining shared budget.
        if (err instanceof GlmProviderError) throw err
        if (attempt === this.maxTransportRetries) break
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError instanceof Error
      ? new GlmProviderError('GLM request failed after bounded transport retries')
      : new GlmProviderError('GLM request failed after retries')
  }
}

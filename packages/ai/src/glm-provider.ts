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
  /** Bounded retries for a transport-level failure only (timeout, DNS, connection reset) -- never for
   * an HTTP error status, which is a real answer from the server, not a "try again" situation. Coding
   * standard §16: "every external call has a timeout and bounded retries". */
  maxTransportRetries?: number
  fetchImpl?: typeof fetch
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

    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxTransportRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        clearTimeout(timer)

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new GlmProviderError(
            `GLM request failed with status ${res.status}: ${text.slice(0, 500)}`,
            res.status,
          )
        }

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
        clearTimeout(timer)
        lastError = err
        // A `GlmProviderError` from a non-ok HTTP status is a real answer, not a transport failure --
        // never retried. Only a genuine transport failure (abort/timeout, network error, malformed
        // JSON) is worth one bounded retry.
        if (err instanceof GlmProviderError) throw err
        if (attempt === this.maxTransportRetries) break
      }
    }
    throw lastError instanceof Error
      ? new GlmProviderError(`GLM request failed after retries: ${lastError.message}`)
      : new GlmProviderError('GLM request failed after retries')
  }
}

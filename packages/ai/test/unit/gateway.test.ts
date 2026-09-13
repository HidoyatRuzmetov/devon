// Exercises `run()`'s three TECH-SPEC §8 rules against a scripted `MockProvider`, with no network:
// (1) max_tokens >= 1024 always, (2) empty content + finish_reason length -> retry with doubled
// max_tokens, (3) a tool call that fails Zod validation -> exactly one retry carrying the error.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadAiConfig } from '../../src/config.js'
import { run } from '../../src/gateway.js'
import { MockProvider } from '../../src/mock-provider.js'
import type { ChatCompletionResult, ChatMessage, ToolDef } from '../../src/types.js'

const config = loadAiConfig({})

const echoSchema = z.object({ title: z.string().min(1) })
const echoTool: ToolDef<z.infer<typeof echoSchema>> = {
  name: 'emit_echo',
  description: 'Echo a title back.',
  schema: echoSchema,
  parameters: {
    type: 'object',
    required: ['title'],
    properties: { title: { type: 'string', minLength: 1 } },
  },
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'You are a test assistant.' },
  { role: 'user', content: '{}' },
]

function toolCallResult(
  args: unknown,
  finishReason: ChatCompletionResult['finishReason'] = 'tool_calls',
): ChatCompletionResult {
  return {
    content: null,
    reasoningContent: null,
    toolCalls: [{ id: 'call-1', name: 'emit_echo', argumentsJson: JSON.stringify(args) }],
    finishReason,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  }
}

function emptyResult(finishReason: ChatCompletionResult['finishReason']): ChatCompletionResult {
  return {
    content: '',
    reasoningContent: 'thinking...',
    toolCalls: [],
    finishReason,
    usage: { promptTokens: 500, completionTokens: 500, totalTokens: 1000 },
  }
}

describe('run() — happy path', () => {
  it('returns validated data and cost/latency metadata on the first try', async () => {
    const provider = new MockProvider({ script: [toolCallResult({ title: 'Hello' })] })
    const result = await run({
      provider,
      config,
      feature: 'quick_add_parse',
      messages,
      tool: echoTool,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.title).toBe('Hello')
      expect(result.meta.totalTokens).toBe(20)
      expect(result.meta.costUzs).toBeGreaterThanOrEqual(0)
      expect(result.meta.retried).toBe(false)
      expect(result.meta.status).toBe('ok')
    }
  })

  it('never asks the provider for fewer than the configured minimum max_tokens', async () => {
    const provider = new MockProvider({ script: [toolCallResult({ title: 'x' })] })
    await run({ provider, config, feature: 'translate', messages, tool: echoTool, maxTokens: 1 })
    expect(provider.calls[0]?.maxTokens).toBeGreaterThanOrEqual(config.minMaxTokens)
  })
})

describe('run() — empty content + finish_reason length', () => {
  it('retries once with doubled max_tokens, then succeeds', async () => {
    const provider = new MockProvider({
      script: [emptyResult('length'), toolCallResult({ title: 'Recovered' })],
    })
    const result = await run({
      provider,
      config,
      feature: 'catch_up',
      messages,
      tool: echoTool,
      maxTokens: 1024,
    })
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1]?.maxTokens).toBe(2048)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.title).toBe('Recovered')
      expect(result.meta.retried).toBe(true)
      // Both calls' usage is summed into the trace, not just the winning one.
      expect(result.meta.totalTokens).toBe(1000 + 20)
    }
  })

  it('reports empty_after_retry when it is still empty after doubling', async () => {
    const provider = new MockProvider({ script: [emptyResult('length'), emptyResult('length')] })
    const result = await run({
      provider,
      config,
      feature: 'catch_up',
      messages,
      tool: echoTool,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.meta.status).toBe('empty_after_retry')
  })

  it('does not retry when finish_reason is not "length"', async () => {
    const provider = new MockProvider({ script: [emptyResult('stop')] })
    const result = await run({ provider, config, feature: 'translate', messages, tool: echoTool })
    expect(provider.calls).toHaveLength(1)
    expect(result.ok).toBe(false)
  })
})

describe('run() — tool-call schema validation', () => {
  it('retries exactly once, with the validation error in the follow-up message, then succeeds', async () => {
    const provider = new MockProvider({
      script: [toolCallResult({ title: '' }), toolCallResult({ title: 'Fixed' })],
    })
    const result = await run({ provider, config, feature: 'translate', messages, tool: echoTool })
    expect(provider.calls).toHaveLength(2)
    const retryMessages = provider.calls[1]?.messages ?? []
    expect(retryMessages.some((m) => m.content?.includes('was rejected'))).toBe(true)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('Fixed')
    if (result.ok) expect(result.meta.retried).toBe(true)
  })

  it('reports schema_invalid_after_retry when the retry is still invalid', async () => {
    const provider = new MockProvider({
      script: [toolCallResult({ title: '' }), toolCallResult({ title: '' })],
    })
    const result = await run({ provider, config, feature: 'translate', messages, tool: echoTool })
    expect(provider.calls).toHaveLength(2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.meta.status).toBe('schema_invalid_after_retry')
  })

  it('falls back to parsing free-text content as JSON when no tool call is present', async () => {
    const provider = new MockProvider({
      script: [
        {
          content: JSON.stringify({ title: 'From content' }),
          reasoningContent: null,
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        },
      ],
    })
    const result = await run({ provider, config, feature: 'translate', messages, tool: echoTool })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('From content')
  })
})

describe('run() — provider errors', () => {
  it('surfaces a rejected provider call as a provider_error result rather than throwing', async () => {
    const provider = new MockProvider({
      respond: () => {
        throw new Error('boom')
      },
    })
    const result = await run({ provider, config, feature: 'translate', messages, tool: echoTool })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.meta.status).toBe('provider_error')
      expect(result.error).toContain('boom')
    }
  })
})

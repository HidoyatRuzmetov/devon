// Exercises the wire mapping and bounded-retry behaviour against an injected `fetchImpl`, never the
// real network (glm-api-instruction.md's base URL is never dialled from a test).
import { describe, expect, it, vi } from 'vitest'
import { GlmProvider, GlmProviderError } from '../../src/glm-provider.js'
import type { ChatCompletionRequest } from '../../src/types.js'

const REQUEST: ChatCompletionRequest = {
  model: 'glm-5.2',
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ],
  maxTokens: 1024,
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('GlmProvider', () => {
  it('keeps the timeout active while the response body is still arriving', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(
        async (_url: unknown, init: RequestInit) =>
          ({
            ok: true,
            json: () =>
              new Promise((_resolve, reject) => {
                init.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
                  once: true,
                })
              }),
          }) as Response,
      )
      const provider = new GlmProvider({
        baseUrl: 'https://example.test/v1',
        apiKey: 'fixture',
        requestTimeoutMs: 5000,
        fetchImpl: fetchImpl as typeof fetch,
      })
      const pending = expect(
        provider.complete({ ...REQUEST, timeoutMs: 1000 }),
      ).rejects.toBeInstanceOf(GlmProviderError)
      await vi.advanceTimersByTimeAsync(1000)
      await pending
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('spends only the remaining request budget on a transport retry', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
            if (fetchImpl.mock.calls.length === 1)
              setTimeout(() => reject(new Error('network down')), 700)
          }),
      )
      const provider = new GlmProvider({
        baseUrl: 'https://example.test/v1',
        apiKey: 'fixture',
        requestTimeoutMs: 5000,
        fetchImpl: fetchImpl as typeof fetch,
      })
      const pending = expect(
        provider.complete({ ...REQUEST, timeoutMs: 1000 }),
      ).rejects.toBeInstanceOf(GlmProviderError)
      await vi.advanceTimersByTimeAsync(1000)
      await pending
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose provider response bodies in error messages', async () => {
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'private input echoed by provider' }, false, 403)),
    })
    await expect(provider.complete(REQUEST)).rejects.toThrow('GLM request failed with status 403')
    await expect(provider.complete(REQUEST)).rejects.not.toThrow('private input')
  })

  it("maps a successful response into the package's own ChatCompletionResult shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: { content: 'hello', reasoning_content: 'thinking', tool_calls: [] },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    )
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'dummy-key-for-test',
      requestTimeoutMs: 5000,
      fetchImpl,
    })

    const result = await provider.complete(REQUEST)
    expect(result.content).toBe('hello')
    expect(result.reasoningContent).toBe('thinking')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.test/v1/chat/completions')
    expect((init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer dummy-key-for-test',
    )
    const body = JSON.parse(init.body as string) as { model: string; max_tokens: number }
    expect(body.model).toBe('glm-5.2')
    expect(body.max_tokens).toBe(1024)
  })

  it('maps tool_calls through with id/name/arguments intact', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'emit_x', arguments: '{"a":1}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'dummy-key-for-test',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    const result = await provider.complete(REQUEST)
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'emit_x', argumentsJson: '{"a":1}' }])
  })

  it('throws GlmProviderError (never retried) on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request' }, false, 400))
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'dummy-key-for-test',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(GlmProviderError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transport failure, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'dummy-key-for-test',
      requestTimeoutMs: 5000,
      maxTransportRetries: 1,
      fetchImpl,
    })
    const result = await provider.complete(REQUEST)
    expect(result.content).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting bounded transport retries', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'dummy-key-for-test',
      requestTimeoutMs: 5000,
      maxTransportRetries: 1,
      fetchImpl,
    })
    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(GlmProviderError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

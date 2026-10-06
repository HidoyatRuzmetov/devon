// Exercises the wire mapping and bounded-retry behaviour against an injected `fetchImpl`, never the
// real network (glm-api-instruction.md's base URL is never dialled from a test).
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => vi.useRealTimers())

function successfulResponse() {
  return jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
}

describe('GlmProvider', () => {
  it.each([429, 503])(
    'honours Retry-After seconds for HTTP %s and retries without reading error bodies',
    async (status) => {
      vi.useFakeTimers()
      const response = new Response('private provider body', {
        status,
        headers: { 'Retry-After': '2' },
      })
      const read = vi.spyOn(response, 'text')
      const cancel = vi.spyOn(response.body!, 'cancel')
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(successfulResponse())
      const provider = new GlmProvider({
        baseUrl: 'https://example.test/v1',
        apiKey: 'fixture',
        requestTimeoutMs: 5000,
        fetchImpl,
      })
      const pending = provider.complete(REQUEST)
      await vi.advanceTimersByTimeAsync(1999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await pending).content).toBe('ok')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(read).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('honours Retry-After HTTP dates relative to the shared deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': 'Tue, 06 Oct 2026 10:00:03 GMT' },
        }),
      )
      .mockResolvedValueOnce(successfulResponse())
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    const pending = provider.complete(REQUEST)
    await vi.advanceTimersByTimeAsync(2999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).content).toBe('ok')
  })

  it.each([undefined, 'invalid', '-1'])(
    'uses bounded fallback backoff for missing/invalid Retry-After %s',
    async (header) => {
      vi.useFakeTimers()
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 503,
            ...(header === undefined ? {} : { headers: { 'Retry-After': header } }),
          }),
        )
        .mockResolvedValueOnce(successfulResponse())
      const provider = new GlmProvider({
        baseUrl: 'https://example.test/v1',
        apiKey: 'fixture',
        requestTimeoutMs: 5000,
        fetchImpl,
      })
      const pending = provider.complete(REQUEST)
      await vi.advanceTimersByTimeAsync(999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await pending).content).toBe('ok')
    },
  )

  it('does not retry early when Retry-After consumes or exceeds the remaining deadline', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '5' } }))
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ status: 429 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('spends only the remaining deadline after HTTP backoff, including a stalled successful body', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockImplementationOnce(async (_url: unknown, init: RequestInit) => ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new Error('body aborted')), {
              once: true,
            })
          }),
      }))
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    const pending = expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(GlmProviderError)
    await vi.advanceTimersByTimeAsync(5000)
    await pending
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares one retry budget across HTTP and transport errors, preventing nested retry multiplication', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'Retry-After': '0' } }))
      .mockRejectedValueOnce(new Error('network down'))
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    const pending = expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(GlmProviderError)
    await vi.runAllTimersAsync()
    await pending
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops at the retry limit for repeated 429 responses and preserves only the status', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn().mockImplementation(
      async () =>
        new Response('private provider body', {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
    )
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      fetchImpl,
    })
    const pending = expect(provider.complete(REQUEST)).rejects.toMatchObject({
      status: 429,
      message: 'GLM request failed with status 429',
    })
    await vi.runAllTimersAsync()
    await pending
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403])(
    'never retries authentication/authorization HTTP %s even with Retry-After',
    async (status) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          new Response('private provider body', { status, headers: { 'Retry-After': '0' } }),
        )
      const provider = new GlmProvider({
        baseUrl: 'https://example.test/v1',
        apiKey: 'fixture',
        requestTimeoutMs: 5000,
        fetchImpl,
      })
      await expect(provider.complete(REQUEST)).rejects.toMatchObject({ status })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    },
  )

  it('honours disabled retries for HTTP overload as well as transport failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503, headers: { 'Retry-After': '0' } }))
    const provider = new GlmProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'fixture',
      requestTimeoutMs: 5000,
      maxTransportRetries: 0,
      fetchImpl,
    })
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

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

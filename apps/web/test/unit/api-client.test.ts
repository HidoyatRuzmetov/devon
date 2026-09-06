import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  NetworkError,
  fetchInstance,
  fetchMe,
  fetchReadyz,
} from '../../src/lib/api-client.js'

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api-client (design.md §1.5/§1.7)', () => {
  it('parses a valid GET /api/v1/instance response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          isDemo: true,
          maintenance: { enabled: false, message: null },
          registrationOpen: true,
          locales: ['uz-Latn', 'uz-Cyrl', 'ru', 'en'],
          defaultLocale: 'uz-Latn',
          setupRequired: false,
        }),
      ),
    )
    const instance = await fetchInstance()
    expect(instance.isDemo).toBe(true)
    expect(instance.setupRequired).toBe(false)
  })

  it('throws ApiError with the Problem code and X-Request-Id on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          401,
          {
            type: 'https://devon.local/problems/unauthenticated',
            title: 'Unauthenticated',
            status: 401,
            code: 'unauthenticated',
          },
          { 'x-request-id': 'req-123' },
        ),
      ),
    )
    const error: unknown = await fetchMe().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(401)
    expect(apiError.code).toBe('unauthenticated')
    expect(apiError.requestId).toBe('req-123')
  })

  it('throws NetworkError, not ApiError, when fetch itself rejects (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchMe()).rejects.toBeInstanceOf(NetworkError)
  })

  it('fetchReadyz treats a 503 as a valid readiness report, not an ApiError (design.md §1.7)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(503, { db: false, valkey: true, migrations: true })),
    )
    const readyz = await fetchReadyz()
    expect(readyz).toEqual({ db: false, valkey: true, migrations: true })
  })
})

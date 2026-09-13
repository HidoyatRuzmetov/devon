// AI L2 (EPIC-016). `probeEmbeddings()` is the one decision the whole retrieval design rests on:
// whether this ministry's GLM deployment serves `/v1/embeddings` at all. The brief required that it
// be *probed at runtime with the configured key*, never assumed, and that the product degrade to
// Postgres full-text search when the answer is no.
//
// So every branch of that probe is tested here against a stubbed `fetch`, and the assertion that
// matters in all of them is the same one: **it never throws**. `apps/api`'s boot path and
// `GET /ai/search/backend` both call it on a request path, and a probe that could throw would turn
// "this deployment has no embeddings model" into a 500 instead of a keyword search.
import { describe, expect, it } from 'vitest'
import { loadAiConfig } from '../../src/config.js'
import { embed, probeEmbeddings, MAX_EMBED_BATCH } from '../../src/embeddings.js'

const config = (overrides: Partial<ReturnType<typeof loadAiConfig>> = {}) => ({
  // `dummy-token-value` rather than anything key-shaped: `check-secrets.mjs` scans this repo for
  // credential-looking assignments, and a test fixture is not worth teaching it an exception for.
  // `config.test.ts` uses the same placeholder.
  ...loadAiConfig({ AI_API_KEY: 'dummy-token-value', AI_BASE_URL: 'https://glm.test/v1' }),
  ...overrides,
})

/** A `fetch` stub that answers by URL suffix; anything unmatched is a 502. */
function stubFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input)
    for (const [suffix, respond] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return respond()
    }
    return new Response('no route', { status: 502 })
  }) as typeof fetch
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const vector = (n: number) => Array.from({ length: n }, (_, i) => i / n)

describe('probeEmbeddings', () => {
  it('refuses without an API key, without making any request at all', async () => {
    let called = false
    const probe = await probeEmbeddings({
      config: config({ apiKey: null }),
      fetchImpl: (() => {
        called = true
        throw new Error('must not be called')
      }) as unknown as typeof fetch,
    })
    expect(called).toBe(false)
    expect(probe).toMatchObject({ available: false, reason: 'no_api_key', model: null })
  })

  it('reports the endpoint as unreachable when /v1/models fails, rather than throwing', async () => {
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({}),
      timeoutMs: 100,
    })
    expect(probe).toMatchObject({ available: false, reason: 'models_endpoint_unreachable' })
  })

  it('is available when /v1/models lists an embeddings model and /v1/embeddings returns the right width', async () => {
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({
        '/models': () => json({ data: [{ id: 'glm-5.2' }, { id: 'embedding-3' }] }),
        '/embeddings': () => json({ data: [{ embedding: vector(1024) }] }),
      }),
    })
    expect(probe).toMatchObject({
      available: true,
      reason: 'ok',
      model: 'embedding-3',
      dimensions: 1024,
    })
    expect(probe.listedEmbeddingModels).toEqual(['embedding-3'])
  })

  it('still tries /v1/embeddings when /v1/models advertises no embeddings model', async () => {
    // Some OpenAI-compatible deployments serve the endpoint without listing the model. One cheap
    // request is a better test than a directory lookup, so an empty listing is not a refusal.
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({
        '/models': () => json({ data: [{ id: 'glm-5.2' }] }),
        '/embeddings': () => json({ data: [{ embedding: vector(1024) }] }),
      }),
    })
    expect(probe.available).toBe(true)
    expect(probe.model).toBe('embedding-3') // the configured default, since nothing was listed
  })

  it('reports no_embeddings_model_listed when nothing was listed and the call also failed', async () => {
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({ '/models': () => json({ data: [{ id: 'glm-5.2' }] }) }),
      timeoutMs: 100,
    })
    expect(probe).toMatchObject({ available: false, reason: 'no_embeddings_model_listed' })
  })

  it('reports embeddings_endpoint_failed when a listed model still cannot answer', async () => {
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({ '/models': () => json({ data: [{ id: 'embedding-3' }] }) }),
      timeoutMs: 100,
    })
    expect(probe).toMatchObject({ available: false, reason: 'embeddings_endpoint_failed' })
  })

  it('refuses a vector of the wrong width rather than writing it into a vector(1024) column', async () => {
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({
        '/models': () => json({ data: [{ id: 'embedding-3' }] }),
        '/embeddings': () => json({ data: [{ embedding: vector(768) }] }),
      }),
    })
    expect(probe).toMatchObject({
      available: false,
      reason: 'dimension_mismatch',
      dimensions: 768,
    })
  })

  it('treats an empty embedding array as a failure, not as a zero-width success', async () => {
    const probe = await probeEmbeddings({
      config: config(),
      fetchImpl: stubFetch({
        '/models': () => json({ data: [{ id: 'embedding-3' }] }),
        '/embeddings': () => json({ data: [{ embedding: [] }] }),
      }),
    })
    expect(probe.available).toBe(false)
  })
})

describe('embed', () => {
  it('returns nothing for an empty batch without calling the endpoint', async () => {
    const result = await embed({
      config: config(),
      model: 'embedding-3',
      inputs: [],
      fetchImpl: (() => {
        throw new Error('must not be called')
      }) as unknown as typeof fetch,
    })
    expect(result).toEqual({ vectors: [], totalTokens: 0 })
  })

  it('refuses a batch larger than MAX_EMBED_BATCH rather than handing the endpoint everything', async () => {
    await expect(
      embed({
        config: config(),
        model: 'embedding-3',
        inputs: Array.from({ length: MAX_EMBED_BATCH + 1 }, () => 'x'),
        fetchImpl: stubFetch({}),
      }),
    ).rejects.toThrow(/MAX_EMBED_BATCH/)
  })

  it('refuses when the endpoint returns a different number of vectors than inputs', async () => {
    await expect(
      embed({
        config: config(),
        model: 'embedding-3',
        inputs: ['a', 'b'],
        fetchImpl: stubFetch({ '/embeddings': () => json({ data: [{ embedding: vector(4) }] }) }),
      }),
      // Silently pairing the wrong vector with the wrong row would make search quietly wrong,
      // which is far worse than a failed batch the sidecar simply retries.
    ).rejects.toThrow(/1 vectors for 2 inputs/)
  })

  it('returns the vectors and the token count on the happy path', async () => {
    const result = await embed({
      config: config(),
      model: 'embedding-3',
      inputs: ['a', 'b'],
      fetchImpl: stubFetch({
        '/embeddings': () =>
          json({
            data: [{ embedding: vector(4) }, { embedding: vector(4) }],
            usage: { total_tokens: 12 },
          }),
      }),
    })
    expect(result.vectors).toHaveLength(2)
    expect(result.totalTokens).toBe(12)
  })

  it('refuses to be called with no API key configured', async () => {
    await expect(
      embed({
        config: config({ apiKey: null }),
        model: 'embedding-3',
        inputs: ['a'],
        fetchImpl: stubFetch({}),
      }),
    ).rejects.toThrow(/AI_API_KEY/)
  })
})

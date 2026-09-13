// AI L2 (EPIC-016, v1.1 SPEC §8): does this GLM deployment offer embeddings at all?
//
// The brief is explicit that this must be *probed at runtime with the configured key*, not assumed:
// `api-llm.gpu.uz` is a chat deployment run by the government for this ministry, and
// `docs/03-plan/integrations/glm-api-instruction.md` documents only `/v1/chat/completions`. Shipping
// semantic search that silently requires `/v1/embeddings` would be a product that works on the
// author's machine and not in the ministry.
//
// So: `probeEmbeddings()` asks `/v1/models` whether an embeddings-looking model is listed, then
// actually calls `/v1/embeddings` once with a two-word input and measures the vector it gets back.
// Both must succeed, and the width must match the column the migration created, or the answer is
// "no" and `apps/api/src/modules/ai/search` uses the Postgres full-text + trigram backend instead --
// with `/ai` telling the reader, in words, which one is in use.
//
// The probe result is cached in-process (a deployment does not grow an embeddings endpoint between
// two requests) and re-probed at most every `PROBE_TTL_MS`.
import type { AiConfig } from './config.js'

export type EmbeddingsProbe = {
  /** Whether `embed()` may be called at all. */
  available: boolean
  /** Which model answered, when one did. */
  model: string | null
  /** The width of the vector the endpoint actually returned. */
  dimensions: number | null
  /** Why not, in one machine-readable word, when `available` is false. Rendered as a sentence by
   * `/ai`'s settings screen -- a head deserves to know *why* search is keyword-based. */
  reason:
    | 'ok'
    | 'no_api_key'
    | 'models_endpoint_unreachable'
    | 'no_embeddings_model_listed'
    | 'embeddings_endpoint_failed'
    | 'dimension_mismatch'
  /** ISO timestamp of the probe. */
  checkedAt: string
  /** The model ids `/v1/models` listed that look like embeddings models, for the settings screen's
   * "what we found" line. Empty when the listing itself failed. */
  listedEmbeddingModels: string[]
}

export const PROBE_TTL_MS = 30 * 60_000

const EMBEDDING_MODEL_HINT = /embed/i

type ModelsResponse = { data?: Array<{ id?: string }> }
type EmbeddingsResponse = { data?: Array<{ embedding?: number[] }> }

export type ProbeOptions = {
  config: AiConfig
  fetchImpl?: typeof fetch
  /** Overridden by tests; production uses `config.requestTimeoutMs`. */
  timeoutMs?: number
}

async function getJson<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One full probe. Never throws: every failure mode is a `reason` on a well-formed answer, because
 * the caller (`apps/api`'s boot path and `GET /ai/search/backend`) must degrade, never 500.
 */
export async function probeEmbeddings(options: ProbeOptions): Promise<EmbeddingsProbe> {
  const { config } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs
  const checkedAt = new Date().toISOString()
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  if (!config.apiKey) {
    return {
      available: false,
      model: null,
      dimensions: null,
      reason: 'no_api_key',
      checkedAt,
      listedEmbeddingModels: [],
    }
  }
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
  }

  let listed: string[]
  try {
    const models = await getJson<ModelsResponse>(
      `${baseUrl}/models`,
      { method: 'GET', headers },
      fetchImpl,
      timeoutMs,
    )
    listed = (models.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => EMBEDDING_MODEL_HINT.test(id))
  } catch {
    return {
      available: false,
      model: null,
      dimensions: null,
      reason: 'models_endpoint_unreachable',
      checkedAt,
      listedEmbeddingModels: [],
    }
  }

  // The configured model wins when the endpoint listed it; otherwise take the first embeddings-
  // looking id the endpoint itself advertised. Only if neither exists do we refuse to try: some
  // OpenAI-compatible deployments serve `/v1/embeddings` without listing the model in `/v1/models`,
  // and one cheap request is a better test than a directory lookup.
  const candidate = listed.includes(config.embeddingsModel)
    ? config.embeddingsModel
    : (listed[0] ?? config.embeddingsModel)

  // Note: an empty `listed` is NOT a refusal. Some OpenAI-compatible deployments serve
  // `/v1/embeddings` without advertising the model in `/v1/models`, and one cheap request is a
  // better test than a directory lookup -- so the probe tries anyway and only reports the more
  // accurate `no_embeddings_model_listed` if that request also fails.
  let dimensions: number
  try {
    const response = await getJson<EmbeddingsResponse>(
      `${baseUrl}/embeddings`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: candidate, input: 'muddat tekshiruvi' }),
      },
      fetchImpl,
      timeoutMs,
    )
    const vector = response.data?.[0]?.embedding
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('empty embedding')
    dimensions = vector.length
  } catch {
    return {
      available: false,
      model: null,
      dimensions: null,
      reason: listed.length === 0 ? 'no_embeddings_model_listed' : 'embeddings_endpoint_failed',
      checkedAt,
      listedEmbeddingModels: listed,
    }
  }

  if (dimensions !== config.embeddingsDimensions) {
    return {
      available: false,
      model: candidate,
      dimensions,
      reason: 'dimension_mismatch',
      checkedAt,
      listedEmbeddingModels: listed,
    }
  }

  return {
    available: true,
    model: candidate,
    dimensions,
    reason: 'ok',
    checkedAt,
    listedEmbeddingModels: listed,
  }
}

export type EmbedResult = { vectors: number[][]; totalTokens: number }

/**
 * Embeds a batch of texts. Bounded (`MAX_BATCH`) so the sidecar job never hands the endpoint a
 * thousand cards in one request, and timed out like every other outbound call in this codebase.
 */
export const MAX_EMBED_BATCH = 32

export async function embed(
  options: ProbeOptions & { model: string; inputs: readonly string[] },
): Promise<EmbedResult> {
  const { config, model, inputs } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs
  if (!config.apiKey) throw new Error('embed() called with no AI_API_KEY configured')
  if (inputs.length === 0) return { vectors: [], totalTokens: 0 }
  if (inputs.length > MAX_EMBED_BATCH) {
    throw new Error(`embed() batch of ${inputs.length} exceeds MAX_EMBED_BATCH=${MAX_EMBED_BATCH}`)
  }

  const body = await getJson<EmbeddingsResponse & { usage?: { total_tokens?: number } }>(
    `${config.baseUrl.replace(/\/+$/, '')}/embeddings`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model, input: inputs }),
    },
    fetchImpl,
    timeoutMs,
  )

  const vectors = (body.data ?? []).map((row) => row.embedding ?? [])
  if (vectors.length !== inputs.length) {
    throw new Error(
      `embeddings endpoint returned ${vectors.length} vectors for ${inputs.length} inputs`,
    )
  }
  return { vectors, totalTokens: body.usage?.total_tokens ?? 0 }
}

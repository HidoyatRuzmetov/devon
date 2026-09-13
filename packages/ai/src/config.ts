// Environment/config for the gateway (decision 15, glm-api-instruction.md). `AI_API_KEY` is read
// lazily, once, from `process.env` -- never hard-coded, never logged, never included in a trace or an
// error message (checked by `test/unit/config.test.ts`). No key configured is not an error: `loadAiConfig`
// falls back to the mock provider so the app, its tests, and a from-scratch clone with no key all work
// (TECH-SPEC §8: "a mock provider for tests and for when no key is configured").
export type AiConfig = {
  /** `https://api-llm.gpu.uz/v1` (glm-api-instruction.md) -- overridable only for tests, never in
   * production config, hence no `.env.example` entry beyond `AI_API_KEY`/`AI_BASE_URL` itself. */
  baseUrl: string
  model: string
  apiKey: string | null
  /** UZS per 1,000,000 tokens, input and output priced identically (glm-api-instruction.md). */
  pricePerMillionTokensUzs: number
  /** TECH-SPEC §8: "max_tokens ≥ 1024 always". Never overridable below this floor. */
  minMaxTokens: number
  /** Ceiling for the "answer truncated -> retry with double" loop -- stops a runaway doubling
   * (1024 -> 2048 -> 4096 -> ...) from ever exceeding this. */
  maxMaxTokens: number
  /** 256k (glm-api-instruction.md) -- `trim.ts` keeps history inside this minus a safety margin for
   * the reply itself. */
  contextWindowTokens: number
  requestTimeoutMs: number
  /** v1.1 AI-AUDIT G-2: the value used when a caller does not name one. Zero, because the default
   * caller in this product is a structured-extraction feature and determinism is the point. */
  defaultTemperature: number
  /**
   * AI L2 (EPIC-016). The embeddings model id to ask this endpoint for, when it has one at all --
   * `embeddings.ts`'s `probeEmbeddings()` is what decides whether it does, at runtime, by calling
   * `/v1/models` and then `/v1/embeddings`. Never assumed: the GLM deployment this ministry uses is
   * a chat deployment, and shipping a product that silently requires an embeddings endpoint it may
   * not have is exactly the kind of assumption the search backend here refuses to make.
   */
  embeddingsModel: string
  /** Dimensions the `card_embeddings.embedding vector(n)` column was created with (migration 0810).
   * A probe reporting a different width makes the embeddings backend unavailable rather than
   * silently writing vectors of the wrong size. */
  embeddingsDimensions: number
}

export const DEFAULT_BASE_URL = 'https://api-llm.gpu.uz/v1'
export const DEFAULT_MODEL = 'glm-5.2'
export const DEFAULT_PRICE_PER_MILLION_UZS = 19_500
export const MIN_MAX_TOKENS = 1024
export const DEFAULT_MAX_MAX_TOKENS = 8192
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_TEMPERATURE = 0
export const DEFAULT_EMBEDDINGS_MODEL = 'embedding-3'
export const DEFAULT_EMBEDDINGS_DIMENSIONS = 1024

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey = env['AI_API_KEY']?.trim() || null
  const dimensions = Number.parseInt(env['AI_EMBEDDINGS_DIMENSIONS']?.trim() ?? '', 10)
  return {
    baseUrl: env['AI_BASE_URL']?.trim() || DEFAULT_BASE_URL,
    model: env['AI_MODEL']?.trim() || DEFAULT_MODEL,
    apiKey,
    pricePerMillionTokensUzs: DEFAULT_PRICE_PER_MILLION_UZS,
    minMaxTokens: MIN_MAX_TOKENS,
    maxMaxTokens: DEFAULT_MAX_MAX_TOKENS,
    contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    defaultTemperature: DEFAULT_TEMPERATURE,
    embeddingsModel: env['AI_EMBEDDINGS_MODEL']?.trim() || DEFAULT_EMBEDDINGS_MODEL,
    embeddingsDimensions:
      Number.isFinite(dimensions) && dimensions > 0 ? dimensions : DEFAULT_EMBEDDINGS_DIMENSIONS,
  }
}

/** Whether `loadAiConfig()` would hand back a config the real provider can use. Callers (the gateway
 * factory in `index.ts`) use this to pick `GlmProvider` vs `MockProvider` -- the one and only branch
 * point between "real GLM" and "mock" in this whole package. */
export function hasApiKey(config: AiConfig): boolean {
  return config.apiKey !== null && config.apiKey.length > 0
}

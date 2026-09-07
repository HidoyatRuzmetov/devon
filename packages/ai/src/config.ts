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
  /** Ceiling for the "empty content + finish_reason length -> retry with double" loop -- stops a
   * runaway doubling (1024 -> 2048 -> 4096 -> ...) from ever exceeding this. */
  maxMaxTokens: number
  /** 256k (glm-api-instruction.md) -- `trim.ts` keeps history inside this minus a safety margin for
   * the reply itself. */
  contextWindowTokens: number
  requestTimeoutMs: number
}

export const DEFAULT_BASE_URL = 'https://api-llm.gpu.uz/v1'
export const DEFAULT_MODEL = 'glm-5.2'
export const DEFAULT_PRICE_PER_MILLION_UZS = 19_500
export const MIN_MAX_TOKENS = 1024
export const DEFAULT_MAX_MAX_TOKENS = 8192
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey = env['AI_API_KEY']?.trim() || null
  return {
    baseUrl: env['AI_BASE_URL']?.trim() || DEFAULT_BASE_URL,
    model: env['AI_MODEL']?.trim() || DEFAULT_MODEL,
    apiKey,
    pricePerMillionTokensUzs: DEFAULT_PRICE_PER_MILLION_UZS,
    minMaxTokens: MIN_MAX_TOKENS,
    maxMaxTokens: DEFAULT_MAX_MAX_TOKENS,
    contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  }
}

/** Whether `loadAiConfig()` would hand back a config the real provider can use. Callers (the gateway
 * factory in `index.ts`) use this to pick `GlmProvider` vs `MockProvider` -- the one and only branch
 * point between "real GLM" and "mock" in this whole package. */
export function hasApiKey(config: AiConfig): boolean {
  return config.apiKey !== null && config.apiKey.length > 0
}

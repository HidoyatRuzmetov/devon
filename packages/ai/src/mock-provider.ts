// The mock provider (TECH-SPEC §8: "a mock provider for tests and for when no key is configured").
// Two independent uses, both served by the same small class:
//
// 1. Unit tests script an exact sequence of responses to prove `gateway.ts`'s retry/validation logic
//    (empty content + finish_reason length -> double max_tokens; a tool call that fails Zod -> one
//    retry with the error) without a network.
// 2. A department with no `AI_API_KEY` configured (a fresh clone, most of CI, a demo box with no
//    budget for a real key) still gets a *working* preview -- not a "feature unavailable" wall --
//    because `respond` below is wired (in `gateway.ts`'s default construction) to each feature's own
//    `simulate()` from `features.ts`, which produces a real, schema-valid, locale-aware answer from
//    the actual input instead of a canned string.
import type { AiProvider, ChatCompletionRequest, ChatCompletionResult } from './types.js'

export type MockProviderOptions = {
  /** Exact responses to return, in order (unit tests). The last one repeats for any call beyond the
   * script's length, so a test does not have to predict exactly how many calls a retry loop makes. */
  script?: ChatCompletionResult[]
  /** The "simulate a real answer" path (production/demo fallback). Ignored once `script` is set. */
  respond?: (request: ChatCompletionRequest) => ChatCompletionResult
}

export class MockProvider implements AiProvider {
  private readonly script: ChatCompletionResult[] | null
  private readonly respond: ((request: ChatCompletionRequest) => ChatCompletionResult) | null
  private cursor = 0
  /** Every request this mock has ever been asked to answer -- unit tests assert on call count/shape
   * without needing a separate spy wrapper. */
  public readonly calls: ChatCompletionRequest[] = []

  constructor(options: MockProviderOptions = {}) {
    this.script = options.script ?? null
    this.respond = options.respond ?? null
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.calls.push(request)
    if (this.script) {
      const index = Math.min(this.cursor, this.script.length - 1)
      this.cursor++
      const result = this.script[index]
      if (!result) throw new Error('MockProvider: empty script')
      return result
    }
    if (this.respond) return this.respond(request)
    throw new Error('MockProvider: no script and no respond() configured')
  }
}

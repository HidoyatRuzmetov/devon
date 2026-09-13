// Typed domain errors for the AI module. `index.ts`'s route handlers catch these and map them to the
// exact RFC 9457 `Problem` the rest of the codebase already uses (`apps/api/src/lib/problem-
// reply.ts`) -- `service.ts` never touches Fastify's `reply` itself, so it stays testable with plain
// function calls, exactly like the events module's own `errors.ts`.
export class AiFeatureDisabledError extends Error {
  constructor(message = 'This AI feature is not enabled for this department') {
    super(message)
    this.name = 'AiFeatureDisabledError'
  }
}

/** 403, not 402: this codebase's `Problem` vocabulary (`@devon/contracts`) has no payment-specific
 * code, and "the department's AI budget for this month is used up" is, from the caller's point of
 * view, exactly the same shape of denial as any other `forbidden` -- nothing this session can do about
 * it, a head needs to raise the cap. `GET /ai/settings` is where the actual UZS numbers live. */
export class AiBudgetExceededError extends Error {
  constructor(message = 'This department has used its AI budget for this month') {
    super(message)
    this.name = 'AiBudgetExceededError'
  }
}

/** The gateway ran (so a trace was written and budget was spent) but could not produce a valid
 * answer -- an empty response even after the retry, or a tool call that still failed schema
 * validation after the one retry `@devon/ai` allows. Never the caller's fault; mapped to `internal`. */
export class AiRunFailedError extends Error {
  constructor(
    message: string,
    /** v1.1 critique SEV2 #23: `'timeout'` means the run exceeded the wall-clock budget its feature
     * declares (`@devon/ai`'s `DEFAULT_FEATURE_TIMEOUT_MS`), which the client turns into "it took
     * too long, try again" plus a retry button -- a different sentence, and a different remedy, from
     * a provider that refused. */
    public readonly kind: 'failed' | 'timeout' = 'failed',
  ) {
    super(message)
    this.name = 'AiRunFailedError'
  }
}

/** The request body's `input` failed the feature's own Zod `inputSchema` before any provider call was
 * ever made -- no trace is written, no budget is spent, mapped to `validation_failed` (422), exactly
 * like any other route's body validation failure. */
export class AiInputValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiInputValidationError'
  }
}

/** H8.1 graceful degradation: the `ai` circuit breaker (`lib/resilience/registry.ts`) is currently
 * open after repeated GLM failures. Thrown *before* the provider is ever called (no trace, no budget
 * spent, no waiting out a timeout that is certain to fail) -- mapped to the same 503 `maintenance`
 * problem the ClamAV-outage path already uses, and to `GET /ai/settings`'s `available: false` so
 * every feature button hides itself (the web layer already gates every AI entry point on
 * `settings.flags[feature] === true` -- `dto.ts` reports every flag as `false` while this is true,
 * without touching a single frontend file outside this module). Deliberately NOT raised for "no
 * AI_API_KEY configured": that is the documented mock-provider fallback (TECH-SPEC §8, `@devon/ai`'s
 * `createProvider`), a working (if fake) AI, not an outage. */
export class AiUnavailableError extends Error {
  constructor(public readonly reason: 'circuit_open') {
    super('The AI provider has failed repeatedly; temporarily circuit-broken')
    this.name = 'AiUnavailableError'
  }
}

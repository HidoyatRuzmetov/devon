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
  constructor(message: string) {
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

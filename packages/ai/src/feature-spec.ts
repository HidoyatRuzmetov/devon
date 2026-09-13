// The shape every `src/prompts/<feature>.ts` exports (v1.1 SPEC §8: "each with system role, fetched
// inputs in a stated shape, constraints, Zod output schema, few-shot examples, temperature per
// feature, golden cases, and a `validateOutput` hook enforcing citations"). `features.ts` therefore
// never contains feature-specific logic itself, only the registry and the two functions
// (`runFeature`, `buildOfflineRespond`) that are identical across every feature.
import type { z } from 'zod'
import type { AiFeature, ChatMessage, Locale } from './types.js'

/**
 * The verdict of a feature's own server-side faithfulness check, run after Zod has already accepted
 * the shape (AI-AUDIT §5 fix 6). Two outcomes, deliberately not three:
 *
 * - `{ ok: true, output }` — accepted, possibly **repaired**: an id the model invented has been
 *   dropped, a confidence downgraded. Repair is right where the rest of the answer is still useful
 *   (quick-add inventing a label) and the user reviews it anyway.
 * - `{ ok: false, error }` — rejected: the answer is not merely imperfect but unfaithful in a way no
 *   preview should render (a plan that silently dropped three of a person's tasks). The gateway
 *   retries once with the reason, then fails the run. A wrong plan shown confidently is worse than
 *   an error the user can retry.
 */
export type ValidateOutcome<TOut> = { ok: true; output: TOut } | { ok: false; error: string }

export type FeatureSpec<TIn extends { locale: Locale }, TOut> = {
  feature: AiFeature
  inputSchema: z.ZodType<TIn>
  outputSchema: z.ZodType<TOut>
  toolName: string
  toolDescription: string
  /** JSON Schema for the tool's `parameters` (see `types.ts`'s `ToolDef.parameters` doc comment for
   * why this is hand-authored rather than derived from `outputSchema`). */
  parameters: Record<string, unknown>
  /** TECH-SPEC §8: "max_tokens >= 1024 always" -- every feature's default already respects that
   * floor; `gateway.ts`'s `run()` re-clamps it anyway, so this is a per-feature *starting point*
   * (a translation needs less headroom than a Monday briefing), not a safety mechanism. */
  defaultMaxTokens: number
  /**
   * v1.1 AI-AUDIT G-2. `0` for every extraction feature (quick-add, risk, analytics, translate,
   * duplicates, assignee): the same sentence must parse to the same fields every time, or the
   * product "feels random" in exactly the way the CTO described. Slightly above zero only where the
   * answer is genuinely a draft a human will rewrite anyway (`draft_event`, `draft_reply`).
   */
  temperature: number
  systemPrompt(input: TIn): string
  /** The single user message's content -- always `JSON.stringify(input)` wrapped in a short
   * instruction, so `offlineRespond` (below) can recover `input` losslessly by parsing it back out,
   * and so a real model gets an unambiguous, complete, structured statement of the task instead of a
   * prose paraphrase that could drop a field. */
  buildUserContent(input: TIn): string
  /**
   * Server-side faithfulness gate. Runs on every answer, from the real model and from `simulate()`
   * alike -- the offline path is exactly where an untested guard rail rots. Must be pure.
   */
  validateOutput?(input: TIn, output: TOut): ValidateOutcome<TOut>
  /** The "no API key configured" / test fallback (TECH-SPEC §8). Pure, synchronous, and good enough
   * to actually preview against -- never a placeholder string -- because a from-scratch clone, most
   * of CI and the management demo box all run with no key at all. v1.1 raises the bar: every
   * simulator must answer in the caller's locale, with the caller's real data, in the full output
   * shape (AI-AUDIT §5 fix 19 -- v1.0's English canned checklists in an Uzbek UI read as broken). */
  simulate(input: TIn): TOut
}

/** Every feature's user message looks exactly like this, which is what makes `offlineRespond`
 * (`features.ts`) able to recover the typed input from a generic `ChatMessage[]` without knowing
 * which feature it is looking at. */
export function buildUserMessage<TIn>(input: TIn): ChatMessage {
  return {
    role: 'user',
    content: JSON.stringify(input),
  }
}

/** The one-line user turn every feature uses. Kept here so the "the JSON below is the complete
 * input" framing is identical in all fourteen prompts. */
export function standardUserContent(input: unknown): string {
  return JSON.stringify(input)
}

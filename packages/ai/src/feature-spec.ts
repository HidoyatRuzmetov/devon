// The shape every `src/prompts/<feature>.ts` exports (MODULE-GUIDE.md-style convention, scoped to
// this package): one small, specific tool per feature (TECH-SPEC §8), its own input/output Zod
// schemas, its own system prompt, and its own offline `simulate()` -- so `features.ts` never contains
// feature-specific logic itself, only the registry and the two functions (`runFeature`,
// `offlineRespond`) that are identical across every feature.
import type { z } from 'zod'
import type { AiFeature, ChatMessage, Locale } from './types.js'

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
   * (a translation needs less headroom than a weekly summary), not a safety mechanism. */
  defaultMaxTokens: number
  systemPrompt(input: TIn): string
  /** The single user message's content -- always `JSON.stringify(input)` wrapped in a short
   * instruction, so `offlineRespond` (below) can recover `input` losslessly by parsing it back out,
   * and so a real model gets an unambiguous, complete, structured statement of the task instead of a
   * prose paraphrase that could drop a field. */
  buildUserContent(input: TIn): string
  /** The "no API key configured" / test fallback (TECH-SPEC §8: "a mock provider ... for when no key
   * is configured"). Pure, synchronous, and good enough to actually preview against -- never a
   * placeholder string -- because a from-scratch clone and most of CI run with no key at all. */
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

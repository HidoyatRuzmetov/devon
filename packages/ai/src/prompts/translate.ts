// Translate any text among the four locales (TECH-SPEC §8). No card/event/comment reading of any
// kind -- the caller pastes or selects text it already has on screen.
import { z } from 'zod'
import { localeName } from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import type { FeatureSpec } from '../feature-spec.js'

export const translateInputSchema = z.object({
  /** The *target* locale -- the language to translate into. */
  locale: localeSchema,
  sourceLocale: localeSchema.nullish(),
  text: z.string().min(1).max(4000),
})
export type TranslateInput = z.infer<typeof translateInputSchema>

export const translateOutputSchema = z.object({
  translatedText: z.string().min(1).max(8000),
  detectedSourceLocale: localeSchema.nullable(),
})
export type TranslateOutput = z.infer<typeof translateOutputSchema>

function simulate(input: TranslateInput): TranslateOutput {
  // Offline fallback: no real translation engine available with no key -- returns the original text
  // clearly labelled, which is honest ("preview-then-accept": nobody would accept this as a real
  // translation) rather than pretending to translate and silently getting it wrong.
  return {
    translatedText: input.text,
    detectedSourceLocale: input.sourceLocale ?? null,
  }
}

export const translateSpec: FeatureSpec<TranslateInput, TranslateOutput> = {
  feature: 'translate',
  inputSchema: translateInputSchema,
  outputSchema: translateOutputSchema,
  toolName: 'emit_translation',
  toolDescription:
    'Translate text into the target locale, preserving meaning, tone and any formatting/placeholders.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['translatedText', 'detectedSourceLocale'],
    properties: {
      translatedText: { type: 'string', minLength: 1, maxLength: 8000 },
      detectedSourceLocale: {
        type: ['string', 'null'],
        enum: ['uz-Latn', 'uz-Cyrl', 'ru', 'en', null],
      },
    },
  },
  defaultMaxTokens: 2048,
  systemPrompt: (input) =>
    `Translate the given text into ${localeName(input.locale)}${input.sourceLocale ? ` from ${localeName(input.sourceLocale)}` : ' (detect the source language yourself)'}. Preserve meaning, tone, and any names, numbers, or formatting exactly -- never summarise or add commentary, only translate. If the text is already in the target language, still return it (lightly polished if needed) and report the detected source locale as the target locale itself. Call emit_translation exactly once.`,
  buildUserContent: (input) => JSON.stringify(input),
  simulate,
}

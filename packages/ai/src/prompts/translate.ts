// F9 translate (v1.1 AI-AUDIT §3 F9, §5 fix 1). The CTO's headline complaint — "it mostly translates
// to Uzbek" — had one cause: two of the three call sites passed the *viewer's own UI locale* as the
// target, so a uz-Latn reader pressing sparkle on an Uzbek description asked for Uzbek → Uzbek, and
// the prompt obligingly returned it "lightly polished".
//
// v1.1: the field is named `targetLocale`, so the overload that caused it cannot recur silently; the
// caller must choose a target; `alreadyInTarget` is reported instead of billing a polish; the
// department glossary travels with the request; and uz-Latn ↔ uz-Cyrl never reaches a model at all
// (AI-AUDIT D-2 — `packages/i18n`'s `latinToCyrillic` already does it deterministically, for free).
import { z } from 'zod'
import {
  DEPARTMENT_GLOSSARY,
  TONE_CONSTRAINT,
  composePrompt,
  localeName,
} from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'
import { normalizeUzLatn } from '../uz.js'

export const translateInputSchema = z.object({
  /** Kept so every feature input satisfies `FeatureSpec<TIn extends { locale }>`: here it is the
   * READER's locale and is used only for `uncertainTerms` phrasing. The target is `targetLocale`. */
  locale: localeSchema,
  /** Renamed from v1.0's overloaded `locale`. This is what the text is translated INTO. */
  targetLocale: localeSchema,
  sourceLocale: localeSchema.nullable().default(null),
  text: z.string().min(1).max(4000),
  /** Terms that must come out exactly as the department spells them. Built by the caller from
   * `packages/i18n/terms.json` for the pair in play. */
  glossary: z
    .array(z.object({ source: z.string().min(1).max(120), target: z.string().min(1).max(120) }))
    .max(60)
    .default([]),
  /** Names, @mentions, URLs, document codes — left byte-identical. */
  preserve: z.array(z.string().min(1).max(200)).max(60).default([]),
})
export type TranslateInput = z.infer<typeof translateInputSchema>

export const translateOutputSchema = z.object({
  translatedText: z.string().min(1).max(8000),
  detectedSourceLocale: localeSchema.nullable(),
  alreadyInTarget: z.boolean(),
  uncertainTerms: z.array(z.string().max(80)).max(8),
})
export type TranslateOutput = z.infer<typeof translateOutputSchema>

/** AI-AUDIT D-2. The client routes this pair through `latinToCyrillic` and never spends a token on
 * it; exported so the API and the web layer agree on exactly which pair is local. */
export function isLocalTransliterationPair(source: Locale | null, target: Locale): boolean {
  if (source === null) return false
  return (
    (source === 'uz-Latn' && target === 'uz-Cyrl') || (source === 'uz-Cyrl' && target === 'uz-Latn')
  )
}

/** The glossary rows for one direction, ready to hand to `translateInputSchema.glossary`. */
export function glossaryFor(
  source: Locale,
  target: Locale,
): Array<{ source: string; target: string }> {
  const column = (locale: Locale) =>
    locale === 'uz-Latn'
      ? (term: (typeof DEPARTMENT_GLOSSARY)[number]) => term.uzLatn
      : locale === 'uz-Cyrl'
        ? (term: (typeof DEPARTMENT_GLOSSARY)[number]) => term.uzCyrl
        : locale === 'ru'
          ? (term: (typeof DEPARTMENT_GLOSSARY)[number]) => term.ru
          : (term: (typeof DEPARTMENT_GLOSSARY)[number]) => term.en
  const from = column(source)
  const to = column(target)
  return DEPARTMENT_GLOSSARY.map((term) => ({ source: from(term), target: to(term) }))
}

const FEW_SHOT = `in : target "ru", source "uz-Latn", glossary [vazifa→задача, muddat→срок, boʻlim→отдел], preserve ["Nodira","EGDI"],
     text "Nodira, EGDI vazifasining muddati juma kuni tugaydi."
out: {"translatedText":"Nodira, срок задачи EGDI истекает в пятницу.","detectedSourceLocale":"uz-Latn","alreadyInTarget":false,"uncertainTerms":[]}

in : target "uz-Latn", source null, text "Yigʻilish ertaga boshlanadi."
out: {"translatedText":"Yigʻilish ertaga boshlanadi.","detectedSourceLocale":"uz-Latn","alreadyInTarget":true,"uncertainTerms":[]}`

function systemPrompt(input: TranslateInput): string {
  const glossary = input.glossary.map((row) => `${row.source} → ${row.target}`).join('; ')
  const orthography =
    input.targetLocale === 'uz-Latn'
      ? 'For uz-Latn you MUST use oʻ and gʻ with U+02BB and the hamza with U+02BC — never an ASCII apostrophe.'
      : input.targetLocale === 'uz-Cyrl'
        ? 'For uz-Cyrl use ў, ғ, қ, ҳ where they belong.'
        : ''
  return composePrompt({
    role: 'You translate internal work text for a ministry department in Uzbekistan. You are a terminology-faithful translator, not an editor. You keep the register formal and administrative.',
    inputs: `A JSON object: targetLocale (${input.targetLocale} — ${localeName(input.targetLocale)}), sourceLocale (${input.sourceLocale ?? 'detect it yourself'}), text, glossary, preserve.
Glossary that must be applied exactly: ${glossary || '(none supplied)'}
Strings that must appear byte-identical in your output: ${input.preserve.join(' | ') || '(none supplied)'}`,
    instructions: [
      `Translate the text into ${localeName(input.targetLocale)}. Do not summarise, expand, explain, correct or improve the author's facts. ${orthography}`,
      'Apply every glossary pair exactly, every time it occurs.',
      'Leave every string in `preserve` untouched: personal names, @mentions, URLs, numbers, dates, document codes such as EGDI or PF-60.',
      'Preserve line breaks, list markers, indentation and punctuation structure exactly. The same number of lines goes out as came in.',
      'If the text is already in the target language, set alreadyInTarget true and return it UNCHANGED. Do not "polish" it. Do not rewrite it.',
      'uncertainTerms: any term you had to guess at — an abbreviation, an internal name, a word with no settled equivalent. Empty when there were none.',
    ],
    constraints: [
      TONE_CONSTRAINT,
      "SHAPE. Never add a greeting, a sign-off or any commentary about the translation. Never change a number or a date format. Never translate a person's name.",
    ],
    examples: FEW_SHOT,
    toolName: 'emit_translation',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// v1.0 returned the input unchanged, which — combined with the viewer-locale bug — meant the offline
// demo behaviour was literally "press sparkle, nothing happens". v1.1 at minimum applies the
// glossary, which is a real, visible, correct transformation, and reports honestly that the rest of
// the text was left alone.

const UZ_LATN_HINT = /(oʻ|gʻ|sh|ch|ning|lar|ekan|boʻ)/i
const UZ_CYRL_HINT = /[ўғқҳ]/
const RU_HINT = /[а-яё]/i
const LATIN_HINT = /[a-z]/i

function detectLocale(text: string): Locale | null {
  if (UZ_CYRL_HINT.test(text)) return 'uz-Cyrl'
  if (RU_HINT.test(text)) return 'ru'
  if (UZ_LATN_HINT.test(text)) return 'uz-Latn'
  if (LATIN_HINT.test(text)) return 'en'
  return null
}

const UNTRANSLATED_NOTE: Record<Locale, string> = {
  'uz-Latn': 'Namunaviy javob — toʻliq tarjima uchun AI kaliti kerak',
  'uz-Cyrl': 'Намунавий жавоб — тўлиқ таржима учун AI калити керак',
  ru: 'Образец ответа — для полного перевода нужен ключ AI',
  en: 'Sample answer — a real translation needs an AI key',
}

function simulate(input: TranslateInput): TranslateOutput {
  const detected = input.sourceLocale ?? detectLocale(input.text)
  if (detected === input.targetLocale) {
    return {
      translatedText: input.text,
      detectedSourceLocale: detected,
      alreadyInTarget: true,
      uncertainTerms: [],
    }
  }

  // Apply the glossary — the one transformation this simulator can do correctly — longest term
  // first, so "boshqarma boshligʻi" is not eaten by "boshliq".
  let out = input.text
  const rows = [...input.glossary].sort((a, b) => b.source.length - a.source.length)
  const applied: string[] = []
  for (const row of rows) {
    const pattern = new RegExp(row.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    if (pattern.test(out)) {
      out = out.replace(pattern, row.target)
      applied.push(row.target)
    }
  }

  return {
    translatedText: out,
    detectedSourceLocale: detected,
    alreadyInTarget: false,
    // Being explicit that the simulator did not really translate is the honest thing to put in the
    // one field the UI renders as "check these".
    uncertainTerms: applied.length > 0 ? [] : [UNTRANSLATED_NOTE[input.locale]],
  }
}

function validateOutput(
  input: TranslateInput,
  output: TranslateOutput,
): ValidateOutcome<TranslateOutput> {
  for (const needle of input.preserve) {
    if (input.text.includes(needle) && !output.translatedText.includes(needle)) {
      return {
        ok: false,
        error: `"${needle}" must appear unchanged in the translation — it is a name, code or mention you were told to preserve.`,
      }
    }
  }
  const linesIn = input.text.split('\n').length
  const linesOut = output.translatedText.split('\n').length
  if (linesIn !== linesOut) {
    return {
      ok: false,
      error: `The input has ${linesIn} line(s) and your answer has ${linesOut}. Preserve the line structure exactly.`,
    }
  }
  if (output.alreadyInTarget && output.translatedText.trim() !== input.text.trim()) {
    // "Already in the target language" and "here is a different text" cannot both be true; trust the
    // text, not the flag, so the UI's "no translation needed" state is never shown over a rewrite.
    return { ok: true, output: { ...output, alreadyInTarget: false } }
  }
  let translatedText = output.translatedText
  if (input.targetLocale === 'uz-Latn' && !output.alreadyInTarget) {
    const protectedStrings = input.preserve
      .filter((value) => translatedText.includes(value))
      .sort((a, b) => b.length - a.length)
    if (protectedStrings.length) {
      const pattern = new RegExp(
        `(${protectedStrings.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
        'g',
      )
      translatedText = translatedText
        .split(pattern)
        .map((part) => (protectedStrings.includes(part) ? part : normalizeUzLatn(part)))
        .join('')
    } else translatedText = normalizeUzLatn(translatedText)
  }
  return {
    ok: true,
    output: {
      ...output,
      translatedText,
      uncertainTerms:
        input.locale === 'uz-Latn'
          ? output.uncertainTerms.map(normalizeUzLatn)
          : output.uncertainTerms,
    },
  }
}

export const translateSpec: FeatureSpec<TranslateInput, TranslateOutput> = {
  feature: 'translate',
  inputSchema: translateInputSchema,
  outputSchema: translateOutputSchema,
  toolName: 'emit_translation',
  toolDescription:
    'Translate work text into the requested target language, applying the department glossary exactly and leaving names, codes and structure untouched.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['translatedText', 'detectedSourceLocale', 'alreadyInTarget', 'uncertainTerms'],
    properties: {
      translatedText: { type: 'string', minLength: 1, maxLength: 8000 },
      detectedSourceLocale: {
        type: ['string', 'null'],
        enum: ['uz-Latn', 'uz-Cyrl', 'ru', 'en', null],
      },
      alreadyInTarget: { type: 'boolean' },
      uncertainTerms: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } },
    },
  },
  defaultMaxTokens: 2048,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

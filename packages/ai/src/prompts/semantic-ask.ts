// AI L2 semantic_ask (EPIC-016, v1.1 SPEC §8). The "Ask" box: a question in plain language, answered
// from the department's own cards, comments, pages and events, with every sentence citing the item it
// came from.
//
// The retrieval happens before this prompt is ever built — `apps/api/src/modules/ai/search` finds the
// passages, either by pgvector similarity (when the GLM deployment turned out to have an embeddings
// model, probed at runtime) or by Postgres full-text search with a trigram fallback. The model is
// handed those passages and nothing else. It cannot search, it cannot browse, and it is told plainly
// that the correct answer to a question the passages do not cover is "I could not find this".
//
// That constraint is the whole design. An "Ask your data" box that answers from the model's own
// knowledge when retrieval comes up empty is how a ministry ends up reading an invented regulation.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  CITATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { idSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const askSourceKindSchema = z.enum(['card', 'comment', 'page', 'event'])
export type AskSourceKind = z.infer<typeof askSourceKindSchema>

export const semanticAskInputSchema = z.object({
  locale: localeSchema,
  question: z.string().min(1).max(400),
  /** Which retrieval backend actually produced these passages -- stated to the model only so it
   * knows how much to trust the ordering, and surfaced in the UI so the reader knows too. */
  backend: z.enum(['embeddings', 'fts']),
  passages: z
    .array(
      z.object({
        /** Stable ref the client turns into a link: `card:<id>`, `page:<id>`, … */
        ref: z.string().min(3).max(220),
        kind: askSourceKindSchema,
        id: idSchema,
        title: z.string().min(1).max(500),
        excerpt: z.string().min(1).max(1500),
        /** 0..1 from the retriever. */
        score: z.number().min(0).max(1).default(0),
      }),
    )
    .max(12)
    .default([]),
})
export type SemanticAskInput = z.infer<typeof semanticAskInputSchema>

export const semanticAskOutputSchema = z.object({
  /** Empty string when the passages do not answer the question — paired with `answered: false`. */
  answer: z.string().max(1200),
  answered: z.boolean(),
  /** The refs the answer actually rests on, in the order they support it. */
  citations: z.array(z.string().min(3).max(220)).max(6),
  /** What the reader should look at or ask next when the answer is partial. */
  followUp: z.string().max(200),
})
export type SemanticAskOutput = z.infer<typeof semanticAskOutputSchema>

const FEW_SHOT = `question "EGDI paketini kim tayyorlayapti?" (locale uz-Latn)
passages: card:c9 "EGDI paketini tayyorlash" — "Masʼul: Nodira Karimova. Muddat 18-sentabr." score 0.81
out: {"answer":"EGDI paketini Nodira Karimova tayyorlayapti, muddat 18-sentabr.","answered":true,"citations":["card:c9"],"followUp":""}

question "Yangi avtomobil xarid qilish tartibi qanday?" (locale uz-Latn)
passages: page:p2 "Ichki tartib" — "Ish vaqti 9:00 dan 18:00 gacha." score 0.22
out: {"answer":"","answered":false,"citations":[],"followUp":"Bu savol boʻyicha boʻlim maʼlumotlarida hech narsa topilmadi. Savolni boshqacha yozib koʻring."}`

function systemPrompt(input: SemanticAskInput): string {
  return composePrompt({
    role: "You answer one question using ONLY the passages you are given from a ministry department's own work board, discussions, pages and events. You are a reader of those passages, not a source of knowledge.",
    inputs: `A JSON object: question, backend (${input.backend}), and passages[] with ref, kind, id, title, excerpt and a retrieval score. ${input.passages.length} passage(s) were found.`,
    instructions: [
      'Answer the question in at most four sentences, using only what the passages say.',
      'If the passages do not answer the question — or answer only a different question that happens to share words — set answered false, leave answer empty, and write one helpful sentence in followUp. This is the correct answer far more often than it feels like it should be.',
      'citations: the refs your answer rests on, copied exactly, in the order they support it. An answer with answered true must cite at least one.',
      'Never merge two passages into a claim neither of them makes.',
      'Never state a date, a name or a number that is not written in a passage.',
      'When the passages conflict, say that they conflict and cite both. Do not pick a winner.',
      'followUp: empty when the answer is complete; otherwise what the reader should look at or ask next.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      CITATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'ABSOLUTE. You have no knowledge of this department beyond the passages above, and no general knowledge that is relevant here. If the answer is not in a passage, you do not know it. Saying "topilmadi" is always better than being approximately right.',
    ],
    examples: FEW_SHOT,
    toolName: 'emit_ask_answer',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// Extractive, which is the honest offline behaviour: return the best passage's own sentence, cite
// it, and say plainly that this is the passage the search found rather than pretending to reason.

const NOT_FOUND: Record<Locale, string> = {
  'uz-Latn':
    'Bu savol boʻyicha boʻlim maʼlumotlarida hech narsa topilmadi. Savolni boshqacha yozib koʻring.',
  'uz-Cyrl':
    'Бу савол бўйича бўлим маълумотларида ҳеч нарса топилмади. Саволни бошқача ёзиб кўринг.',
  ru: 'По этому вопросу в данных отдела ничего не найдено. Попробуйте сформулировать иначе.',
  en: "Nothing in the department's own data answers this. Try asking it differently.",
}

const FOUND_IN: Record<Locale, (title: string) => string> = {
  'uz-Latn': (title) => `Eng mos yozuv: "${title}".`,
  'uz-Cyrl': (title) => `Энг мос ёзув: "${title}".`,
  ru: (title) => `Наиболее подходящая запись: «${title}».`,
  en: (title) => `The closest record is "${title}".`,
}

function simulate(input: SemanticAskInput): SemanticAskOutput {
  const best = [...input.passages].sort((a, b) => b.score - a.score)[0]
  if (!best || best.score < 0.2) {
    return { answer: '', answered: false, citations: [], followUp: NOT_FOUND[input.locale] }
  }
  const sentence = best.excerpt.split(/(?<=[.!?])\s+/)[0] ?? best.excerpt
  return {
    answer: `${FOUND_IN[input.locale](best.title)} ${sentence}`.slice(0, 1200),
    answered: true,
    citations: [best.ref],
    followUp: '',
  }
}

function validateOutput(
  input: SemanticAskInput,
  output: SemanticAskOutput,
): ValidateOutcome<SemanticAskOutput> {
  const refs = new Set(input.passages.map((passage) => passage.ref))
  const citations = output.citations.filter((ref) => refs.has(ref))

  if (output.answered && citations.length === 0) {
    // An answer with no surviving citation is, by this feature's own contract, a made-up answer.
    // There is no repair for it: it is rejected, and the reader sees "not found" rather than prose.
    return {
      ok: false,
      error:
        'You answered but cited no passage that was given to you. Either cite the passages your answer rests on, or set answered false with an empty answer.',
    }
  }
  if (!output.answered && output.answer.trim().length > 0) {
    return { ok: true, output: { ...output, answer: '', citations: [] } }
  }
  return { ok: true, output: { ...output, citations } }
}

export const semanticAskSpec: FeatureSpec<SemanticAskInput, SemanticAskOutput> = {
  feature: 'semantic_ask',
  inputSchema: semanticAskInputSchema,
  outputSchema: semanticAskOutputSchema,
  toolName: 'emit_ask_answer',
  toolDescription:
    "Answer one question using only the retrieved passages from this department's own data, citing each source, or say plainly that the answer is not there.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'answered', 'citations', 'followUp'],
    properties: {
      answer: { type: 'string', maxLength: 1200 },
      answered: { type: 'boolean' },
      citations: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 220 } },
      followUp: { type: 'string', maxLength: 200 },
    },
  },
  defaultMaxTokens: 1536,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

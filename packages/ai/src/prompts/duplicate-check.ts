// N-5 duplicate_check (v1.1 AI-AUDIT §4 "Add"; TECH-SPEC §8's never-built "duplicate/related card
// detection"). "Bunga oʻxshash vazifa allaqachon bor."
//
// Deliberately scoped as **prefilter + one confirmation call**, exactly as the audit recommends:
// the server narrows the whole board to a handful of candidates (trigram similarity, or embeddings
// when the endpoint has them — `apps/api/src/modules/ai/search`), and the model only answers "are
// any of these the same work, and if so which". It never searches; it never sees the board.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { idSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const duplicateCheckInputSchema = z.object({
  locale: localeSchema,
  candidateTitle: z.string().min(1).max(500),
  candidateDescription: z.string().max(2000).nullable().default(null),
  /** What the prefilter found. At most ten: this is a confirmation call, not a search. */
  existing: z
    .array(
      z.object({
        id: idSchema,
        title: z.string().min(1).max(500),
        status: z.enum(['active', 'done', 'archived']),
        assigneeName: z.string().max(200).nullable().default(null),
        /** 0..1 from the prefilter, so the model knows what the machine already thought. */
        similarity: z.number().min(0).max(1).default(0),
      }),
    )
    .min(0)
    .max(10),
})
export type DuplicateCheckInput = z.infer<typeof duplicateCheckInputSchema>

export const duplicateCheckOutputSchema = z.object({
  matches: z
    .array(
      z.object({
        cardId: idSchema,
        /** duplicate = the same work; related = adjacent work worth linking, not merging. */
        relation: z.enum(['duplicate', 'related']),
        reason: z.string().min(1).max(200),
      }),
    )
    .max(3),
  /** The honest majority answer: nothing here is the same work. */
  verdict: z.enum(['duplicate', 'related_only', 'none']),
})
export type DuplicateCheckOutput = z.infer<typeof duplicateCheckOutputSchema>

const FEW_SHOT = `candidateTitle "EGDI koʻrsatkichlarini yigʻish", locale uz-Latn
existing: c4 "EGDI koʻrsatkichlari boʻyicha maʼlumot yigʻish" active Nodira 0.82 | c9 "EGDI paketini vazirlikka yuborish" active Anvar 0.44
out: {"matches":[{"cardId":"c4","relation":"duplicate","reason":"Ikkalasi ham EGDI koʻrsatkichlarini yigʻish — bir xil ish."},
                {"cardId":"c9","relation":"related","reason":"Shu paketning keyingi bosqichi."}],
 "verdict":"duplicate"}

candidateTitle "Yangi printer sotib olish", existing: c2 "Sayt matnini tahrirlash" active 0.11
out: {"matches":[],"verdict":"none"}`

function systemPrompt(input: DuplicateCheckInput): string {
  return composePrompt({
    role: 'You decide whether a work item somebody is about to create already exists. You are shown a small, already-shortlisted set of existing items; you never search and you never see the rest of the board.',
    inputs: `A JSON object: candidateTitle, candidateDescription, and existing[] with id, title, status, assigneeName and a machine similarity score between 0 and 1.`,
    instructions: [
      'A "duplicate" means the same work would be done twice. Same deliverable, same scope. A different wording of the same job is a duplicate; the next stage of the same job is not.',
      'These candidates are independent tasks, not assignments within a shared group project. Never infer duplication from ordinary collaboration or from a shared project name. If existing is empty, return matches [] and verdict "none".',
      '"related" means work worth linking to but not merging — a neighbouring stage, the same project, the same document at a different step.',
      'Return at most three matches, the strongest first. Most of the time the correct answer is an empty array.',
      'reason: one sentence saying what makes them the same work, or what connects them. Never restate the two titles back at the reader.',
      'verdict: "duplicate" if any match is a duplicate; "related_only" if there are matches but none is a duplicate; "none" if there are no matches at all.',
      'A high similarity score is evidence, not an instruction. Two items can share every word and still be different work ("2025 hisoboti" and "2026 hisoboti"). Say so by returning nothing.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'SHAPE. Every cardId must be copied from the existing list. Never invent an item, and never claim an item exists that you were not shown.',
    ],
    examples: FEW_SHOT,
    toolName: 'emit_duplicate_check',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// Token-overlap Jaccard over the normalised titles, which is exactly the kind of honest heuristic
// the prefilter itself uses -- so offline the feature behaves as "the machine's own opinion,
// unconfirmed", which is a truthful degradation rather than a fake second opinion.

const SAME_WORK: Record<Locale, string> = {
  'uz-Latn': 'Ikkala vazifa ham bir xil ishni bildiradi.',
  'uz-Cyrl': 'Иккала вазифа ҳам бир хил ишни билдиради.',
  ru: 'Обе задачи описывают одну и ту же работу.',
  en: 'Both items describe the same piece of work.',
}

const NEIGHBOUR: Record<Locale, string> = {
  'uz-Latn': 'Shu yoʻnalishdagi yaqin vazifa — bogʻlab qoʻysa boʻladi.',
  'uz-Cyrl': 'Шу йўналишдаги яқин вазифа — боғлаб қўйса бўлади.',
  ru: 'Соседняя задача в том же направлении — стоит связать.',
  en: 'Adjacent work in the same area — worth linking.',
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / (a.size + b.size - shared)
}

function simulate(input: DuplicateCheckInput): DuplicateCheckOutput {
  const candidate = tokens(`${input.candidateTitle} ${input.candidateDescription ?? ''}`)
  const scored = input.existing
    .map((item) => ({
      item,
      score: Math.max(item.similarity, jaccard(candidate, tokens(item.title))),
    }))
    .filter((row) => row.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const matches = scored.map((row) => ({
    cardId: row.item.id,
    relation: (row.score >= 0.62 ? 'duplicate' : 'related') as 'duplicate' | 'related',
    reason: row.score >= 0.62 ? SAME_WORK[input.locale] : NEIGHBOUR[input.locale],
  }))

  return {
    matches,
    verdict: matches.some((match) => match.relation === 'duplicate')
      ? 'duplicate'
      : matches.length > 0
        ? 'related_only'
        : 'none',
  }
}

function validateOutput(
  input: DuplicateCheckInput,
  output: DuplicateCheckOutput,
): ValidateOutcome<DuplicateCheckOutput> {
  const ids = new Set(input.existing.map((item) => item.id))
  const seen = new Set<string>()
  const matches = output.matches.filter((match) => {
    if (!ids.has(match.cardId) || seen.has(match.cardId)) return false
    seen.add(match.cardId)
    return true
  })
  const verdict: DuplicateCheckOutput['verdict'] = matches.some((m) => m.relation === 'duplicate')
    ? 'duplicate'
    : matches.length > 0
      ? 'related_only'
      : 'none'
  // The verdict is derived, never trusted: a "duplicate" verdict with no duplicate match is exactly
  // the shape of a warning a person would act on and find nothing behind.
  return { ok: true, output: { matches, verdict } }
}

export const duplicateCheckSpec: FeatureSpec<DuplicateCheckInput, DuplicateCheckOutput> = {
  feature: 'duplicate_check',
  inputSchema: duplicateCheckInputSchema,
  outputSchema: duplicateCheckOutputSchema,
  toolName: 'emit_duplicate_check',
  toolDescription:
    'Decide whether a work item about to be created is the same work as one of a small shortlist of existing items, or merely related to them.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['matches', 'verdict'],
    properties: {
      matches: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cardId', 'relation', 'reason'],
          properties: {
            cardId: { type: 'string' },
            relation: { type: 'string', enum: ['duplicate', 'related'] },
            reason: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
      verdict: { type: 'string', enum: ['duplicate', 'related_only', 'none'] },
    },
  },
  defaultMaxTokens: 1024,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

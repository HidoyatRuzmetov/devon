// N-3 suggest_assignee (v1.1 AI-AUDIT §4 "Add", SPEC §8). "Kimga topshiray?"
//
// This is the feature with the sharpest guard rail in the whole set, and it is worth stating plainly:
// a system that ranks civil servants against each other, in a government office, is a performance
// instrument whether or not anyone calls it one. So:
//
//   * the only permitted reasons are WORKLOAD and RECENT SUBJECT EXPERIENCE. Speed, quality,
//     reliability and any comparison of one person's competence with another's are forbidden, in the
//     prompt and again in `validateOutput`;
//   * `loadWarning` exists so a suggestion can say "and this person is already carrying nine items",
//     which is the fact the head most needs and the one a naive ranker would hide;
//   * the head always chooses. The UI pre-selects nothing.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { confidenceSchema, idSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const suggestAssigneeInputSchema = z.object({
  locale: localeSchema,
  card: z.object({
    id: idSchema,
    title: z.string().min(1).max(500),
    labels: z.array(z.string().min(1).max(80)).max(20).default([]),
    projectTitle: z.string().max(300).nullable().default(null),
    estimateMin: z.number().int().min(0).max(10_000).nullable().default(null),
  }),
  candidates: z
    .array(
      z.object({
        userId: idSchema,
        fullName: z.string().min(1).max(200),
        /** Open items right now. */
        openCount: z.number().int().min(0),
        overdueCount: z.number().int().min(0),
        /** Labels this person has worked on recently — the experience signal, and the only one. */
        recentLabels: z.array(z.string().min(1).max(80)).max(20).default([]),
        /** Whether this person is away (leave, trip). A suggestion that ignores it is noise. */
        away: z.boolean().nullable().default(null),
      }),
    )
    .min(1)
    .max(200),
})
export type SuggestAssigneeInput = z.infer<typeof suggestAssigneeInputSchema>

export const suggestAssigneeOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        userId: idSchema,
        rank: z.number().int().min(1).max(3),
        /** Workload or subject experience only. Never a judgement. */
        reason: z.string().min(1).max(180),
        loadWarning: z.string().max(180),
        confidence: confidenceSchema,
      }),
    )
    .max(3),
  /** Set when nobody is a good fit — an honest empty answer beats a confident wrong one. */
  note: z.string().max(200),
})
export type SuggestAssigneeOutput = z.infer<typeof suggestAssigneeOutputSchema>

const FEW_SHOT = `card "EGDI koʻrsatkichlarini yangilash", labels ["EGDI"], locale uz-Latn
candidates: u1 Nodira open 4 overdue 1 recentLabels ["EGDI","hisobot"] | u2 Anvar open 9 overdue 2 recentLabels ["sayt"] | u3 Dilnoza open 2 overdue 0 recentLabels []
out: {"suggestions":[
 {"userId":"u1","rank":1,"reason":"Yaqinda EGDI yorligʻi bilan ishlagan","loadWarning":"","confidence":"high"},
 {"userId":"u3","rank":2,"reason":"Hozir eng kam yuk — 2 ta ochiq vazifa","loadWarning":"","confidence":"medium"},
 {"userId":"u2","rank":3,"reason":"Boʻlimda mavjud","loadWarning":"Anvarda 9 ta ochiq vazifa bor","confidence":"low"}],
 "note":""}`

function systemPrompt(input: SuggestAssigneeInput): string {
  const median =
    [...input.candidates.map((c) => c.openCount)].sort((a, b) => a - b)[
      Math.floor(input.candidates.length / 2)
    ] ?? 0
  return composePrompt({
    role: 'You suggest, to the head of a ministry department, who could take one work item. You are a workload assistant, not an evaluator. The head decides; you only lay out the facts they would otherwise have to look up.',
    inputs: `A JSON object: card (title, labels, projectTitle, estimateMin) and candidates[] with userId, fullName, openCount, overdueCount, recentLabels, away. The median open count in this unit is ${median}.`,
    instructions: [
      'Return at most three suggestions, ranked. Rank 1 is your first choice.',
      "Base the ranking on exactly two things, in this order: (a) recent experience — does this person's recentLabels overlap the card's labels or project; (b) available capacity — a lower openCount than the unit median.",
      'Never rank somebody who is away above somebody who is not.',
      'away=null means absence is unknown because no leave or working-hours record was supplied. Never assert physical presence or guaranteed free time from that. Open-card counts show workload, not free working minutes.',
      'reason: one short sentence, naming the workload or experience fact you used, in the reader\'s language. "Yaqinda EGDI yorligʻi bilan ishlagan". "Hozir eng kam yuk — 2 ta ochiq vazifa".',
      'loadWarning: when openCount is at least 1.5 times the median, state the number plainly ("Anvarda 9 ta ochiq vazifa bor"). Empty string otherwise. This is a warning to the head, not an argument against the person.',
      'confidence: high only when experience AND capacity both point the same way. Capacity alone is medium. Neither is low.',
      'If every candidate is away, or none has any capacity or any related experience, return an empty suggestions array and say so in `note`. An honest "nobody is a good fit right now" is a useful answer.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'FORBIDDEN. Never say or imply that one person is faster, better, more reliable, more careful, more competent or more experienced *as a person* than another. Never mention overdueCount as a criticism. Never rank by past performance of any kind. Only current workload and recent subject matter.',
    ],
    examples: FEW_SHOT,
    toolName: 'emit_assignee_suggestions',
  })
}

// -- Offline simulator ------------------------------------------------------------------------

type Phrases = {
  experience: (label: string) => string
  capacity: (open: number) => string
  available: string
  warning: (name: string, open: number) => string
  nobody: string
  away: string
}

const PHRASES: Record<Locale, Phrases> = {
  'uz-Latn': {
    experience: (label) => `Yaqinda "${label}" yorligʻi bilan ishlagan`,
    capacity: (open) => `Hozir eng kam yuk — ${open} ta ochiq vazifa`,
    available: 'Boʻlimda mavjud',
    warning: (name, open) => `${name}da ${open} ta ochiq vazifa bor`,
    nobody: 'Hozircha mos xodim yoʻq — hamma band yoki ishda emas.',
    away: 'Hozir ishda emas',
  },
  'uz-Cyrl': {
    experience: (label) => `Яқинда "${label}" ёрлиғи билан ишлаган`,
    capacity: (open) => `Ҳозир энг кам юк — ${open} та очиқ вазифа`,
    available: 'Бўлимда мавжуд',
    warning: (name, open) => `${name}да ${open} та очиқ вазифа бор`,
    nobody: 'Ҳозирча мос ходим йўқ — ҳамма банд ёки ишда эмас.',
    away: 'Ҳозир ишда эмас',
  },
  ru: {
    experience: (label) => `Недавно работал(а) с меткой «${label}»`,
    capacity: (open) => `Сейчас наименьшая нагрузка — ${open} открытых задач`,
    available: 'Есть в отделе',
    warning: (name, open) => `У ${name} ${open} открытых задач`,
    nobody: 'Подходящего сотрудника сейчас нет — все заняты или отсутствуют.',
    away: 'Сейчас отсутствует',
  },
  en: {
    experience: (label) => `Recently worked with the "${label}" label`,
    capacity: (open) => `Lightest load right now — ${open} open items`,
    available: 'Available in the unit',
    warning: (name, open) => `${name} carries ${open} open items`,
    nobody: 'Nobody is a good fit right now — everyone is loaded or away.',
    away: 'Currently away',
  },
}

function simulate(input: SuggestAssigneeInput): SuggestAssigneeOutput {
  const p = PHRASES[input.locale]
  const wanted = new Set(
    [...input.card.labels, ...(input.card.projectTitle ? [input.card.projectTitle] : [])].map((v) =>
      v.toLowerCase(),
    ),
  )
  const counts = input.candidates.map((c) => c.openCount).sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)] ?? 0
  const lightest = counts[0] ?? 0

  const scored = input.candidates.map((candidate) => {
    const overlap = candidate.recentLabels.find((label) => wanted.has(label.toLowerCase())) ?? null
    const spare = Math.max(0, median - candidate.openCount)
    return {
      candidate,
      overlap,
      score: (candidate.away ? -1000 : 0) + (overlap ? 100 : 0) + spare * 5 - candidate.openCount,
    }
  })

  const usable = scored.filter((row) => !row.candidate.away)
  if (usable.length === 0) {
    return { suggestions: [], note: p.nobody }
  }

  const top = [...usable].sort((a, b) => b.score - a.score).slice(0, 3)
  return {
    suggestions: top.map((row, index) => ({
      userId: row.candidate.userId,
      rank: index + 1,
      reason: row.overlap
        ? p.experience(row.overlap)
        : row.candidate.openCount <= lightest
          ? p.capacity(row.candidate.openCount)
          : p.available,
      loadWarning:
        row.candidate.openCount >= Math.max(1, median * 1.5)
          ? p.warning(row.candidate.fullName, row.candidate.openCount)
          : '',
      confidence: (row.overlap && row.candidate.openCount <= median
        ? 'high'
        : row.overlap || row.candidate.openCount <= median
          ? 'medium'
          : 'low') as 'high' | 'medium' | 'low',
    })),
    note: '',
  }
}

/** The words a suggestion may never contain, in all four locales. A model that reached for
 * "faster"/"более надёжный"/"tezroq" has turned a workload helper into a performance ranking, and
 * this is a government office. Rejected, not repaired: rewriting the sentence for it would hide the
 * fact that it did it. */
const JUDGEMENT_WORDS =
  /\b(tezroq|sekin|yaxshiroq|yomonroq|ishonchli|puxta|sifatliroq|layoqatli|tajribali\s+xodim|быстрее|надёжн|надежн|лучше|хуже|качественн|компетентн|опытнее|faster|slower|better|worse|more reliable|most reliable|more competent|hardest.working|best performer)\b/i

function validateOutput(
  input: SuggestAssigneeInput,
  output: SuggestAssigneeOutput,
): ValidateOutcome<SuggestAssigneeOutput> {
  const byId = new Map(input.candidates.map((candidate) => [candidate.userId, candidate]))
  for (const suggestion of output.suggestions) {
    if (JUDGEMENT_WORDS.test(suggestion.reason) || JUDGEMENT_WORDS.test(suggestion.loadWarning)) {
      return {
        ok: false,
        error:
          "A reason compared one person's ability, speed or reliability with another's. Rewrite using only current workload (open item counts) and recent subject-matter experience (labels).",
      }
    }
    if (!byId.has(suggestion.userId)) {
      return {
        ok: false,
        error: `"${suggestion.userId}" is not one of the candidate user ids you were given.`,
      }
    }
  }

  const seen = new Set<string>()
  const suggestions = output.suggestions
    .filter((suggestion) => {
      const candidate = byId.get(suggestion.userId)!
      if (seen.has(suggestion.userId)) return false
      seen.add(suggestion.userId)
      // Somebody who is away cannot be a suggestion, whatever the model thought.
      return !candidate.away
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((suggestion, index) => ({
      ...suggestion,
      rank: index + 1,
      // The number in a load warning is a database fact, not a paraphrase.
      loadWarning: suggestion.loadWarning.replace(
        /\d+/,
        String(byId.get(suggestion.userId)!.openCount),
      ),
    }))

  return { ok: true, output: { ...output, suggestions } }
}

export const suggestAssigneeSpec: FeatureSpec<SuggestAssigneeInput, SuggestAssigneeOutput> = {
  feature: 'suggest_assignee',
  inputSchema: suggestAssigneeInputSchema,
  outputSchema: suggestAssigneeOutputSchema,
  toolName: 'emit_assignee_suggestions',
  toolDescription:
    'Suggest up to three people who could take one work item, ranked by current workload and recent subject experience only — never by performance.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions', 'note'],
    properties: {
      suggestions: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'rank', 'reason', 'loadWarning', 'confidence'],
          properties: {
            userId: { type: 'string' },
            rank: { type: 'integer', minimum: 1, maximum: 3 },
            reason: { type: 'string', minLength: 1, maxLength: 180 },
            loadWarning: { type: 'string', maxLength: 180 },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      note: { type: 'string', maxLength: 200 },
    },
  },
  defaultMaxTokens: 1280,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

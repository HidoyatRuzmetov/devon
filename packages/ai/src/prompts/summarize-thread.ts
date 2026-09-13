// F7 summarize_thread (v1.1 AI-AUDIT §3 F7). The v1.0 prompt already asked for the right three
// things — decisions, open questions, commitments — and then flattened them into one `summary`
// string, so none of them could be rendered distinctly or linked to the comment it came from.
//
// v1.1 returns the three lists with comment ids, plus one line saying what is expected of the
// person reading. Accept never auto-posts a comment any more (that change is in the card detail
// screen, AI-AUDIT §5 fix 13): an AI-written comment entering a ministry's audit trail under a
// human's name is a governance problem, not a convenience.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  CITATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { idSchema, isoDateSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const summarizeThreadInputSchema = z.object({
  locale: localeSchema,
  subject: z.object({
    kind: z.enum(['card', 'event']),
    id: idSchema,
    title: z.string().min(1).max(500),
  }),
  viewerName: z.string().min(1).max(200),
  comments: z
    .array(
      z.object({
        id: idSchema,
        author: z.string().min(1).max(200),
        text: z.string().min(1).max(4000),
        createdAt: z.string().max(40),
      }),
    )
    .min(1)
    .max(500),
})
export type SummarizeThreadInput = z.infer<typeof summarizeThreadInputSchema>

export const summarizeThreadOutputSchema = z.object({
  decisions: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        commentIds: z.array(idSchema).min(1).max(3),
      }),
    )
    .max(8),
  openQuestions: z
    .array(z.object({ text: z.string().min(1).max(300), commentId: idSchema }))
    .max(8),
  commitments: z
    .array(
      z.object({
        who: z.string().min(1).max(200),
        what: z.string().min(1).max(250),
        byWhen: isoDateSchema.nullable(),
        commentId: idSchema,
      }),
    )
    .max(10),
  forViewer: z.string().max(250),
})
export type SummarizeThreadOutput = z.infer<typeof summarizeThreadOutputSchema>

const FEW_SHOT = `comments: k1 Anvar "Sentabr raqamlari boʻyicha kelishdik — 14 ta xizmat." | k2 Nodira "Yakuniy PDF-ni ertaga yuboraman." | k3 Dilnoza "Vazirlik shaklini kim toʻldiradi?"
viewerName "Dilnoza Karimova", locale uz-Latn
out: {"decisions":[{"text":"Sentabr uchun 14 ta xizmat raqami tasdiqlandi.","commentIds":["k1"]}],
 "openQuestions":[{"text":"Vazirlik shaklini kim toʻldirishi hal qilinmagan.","commentId":"k3"}],
 "commitments":[{"who":"Nodira","what":"Yakuniy PDF-ni yuborish","byWhen":null,"commentId":"k2"}],
 "forViewer":"Vazirlik shakli boʻyicha savolingizga hali javob berilmagan."}`

function systemPrompt(input: SummarizeThreadInput): string {
  const authors = [...new Set(input.comments.map((comment) => comment.author))]
  return composePrompt({
    role: 'You read a work discussion in a ministry department and extract its outcome. You separate what was decided from what is still open from what somebody committed to. You quote nothing; you attribute everything to a comment id.',
    inputs: `A JSON object: subject (a ${input.subject.kind} titled "${input.subject.title}"), viewerName (${input.viewerName}), and comments[] with id, author, text, createdAt, in chronological order.
The only author names that exist in this thread: ${authors.join(', ')}.`,
    instructions: [
      'decisions: statements the thread actually settled. Each cites one to three comment ids. If nothing was decided, return an empty array — never manufacture a decision to fill the section.',
      'openQuestions: things asked and not answered, or explicitly deferred. Each cites the comment that raised it.',
      'commitments: who promised what, by when. `who` must be one of the author names listed above, spelled exactly. `byWhen` only when a date or a specific day was actually stated; otherwise null. Never convert "tez orada" or "soon" into a date.',
      `forViewer: one sentence naming what ${input.viewerName} is expected to do next, or an empty string if nothing is.`,
      'Order every array by the createdAt of the comment it cites.',
      'Never summarise mood or tone. Never editorialise. Never say who was right.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      CITATION_CONSTRAINT,
      TONE_CONSTRAINT,
      "SHAPE. Every commentId must be copied verbatim from the input. Never translate a person's name.",
    ],
    examples: FEW_SHOT,
    toolName: 'emit_thread_summary',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// v1.0 joined the last three comments with a pipe. v1.1 classifies each comment with the cues the
// four locales actually use, which is honest about being a heuristic and still produces a
// three-section preview a demo can be run against.

const QUESTION_CUE =
  /\?|\bkim\b|\bqachon\b|\bqanday\b|\bкто\b|\bкогда\b|\bкак\b|\bwho\b|\bwhen\b|\bhow\b/i
const DECISION_CUE =
  /(kelishdik|qaror qilindi|tasdiqlandi|kelishildi|решили|договорились|утвержд|agreed|decided|approved)/i
const COMMITMENT_CUE =
  /(yuboraman|tayyorlayman|qilaman|boshlayman|topshiraman|отправлю|подготовлю|сделаю|займусь|i will|i'll|will send|will prepare)/i

const NOTHING_FOR_VIEWER = ''

const VIEWER_LINE: Record<Locale, (title: string) => string> = {
  'uz-Latn': (title) => `"${title}" boʻyicha savolingizga hali javob berilmagan.`,
  'uz-Cyrl': (title) => `"${title}" бўйича саволингизга ҳали жавоб берилмаган.`,
  ru: (title) => `На ваш вопрос по «${title}» пока не ответили.`,
  en: (title) => `Your question about "${title}" has not been answered yet.`,
}

function firstSentence(text: string, max = 240): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const stop = trimmed.search(/[.!?](\s|$)/)
  const sentence = stop > 10 ? trimmed.slice(0, stop + 1) : trimmed
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence
}

function simulate(input: SummarizeThreadInput): SummarizeThreadOutput {
  const decisions: SummarizeThreadOutput['decisions'] = []
  const openQuestions: SummarizeThreadOutput['openQuestions'] = []
  const commitments: SummarizeThreadOutput['commitments'] = []

  for (const comment of input.comments) {
    if (DECISION_CUE.test(comment.text)) {
      decisions.push({ text: firstSentence(comment.text, 300), commentIds: [comment.id] })
    } else if (COMMITMENT_CUE.test(comment.text)) {
      commitments.push({
        who: comment.author,
        what: firstSentence(comment.text, 250),
        byWhen: null,
        commentId: comment.id,
      })
    } else if (QUESTION_CUE.test(comment.text)) {
      openQuestions.push({ text: firstSentence(comment.text, 300), commentId: comment.id })
    }
  }

  // A question is only open if nothing came after it -- the cheapest honest approximation available
  // without a model, and it keeps the section from filling up with answered questions.
  const lastIndex = new Map(input.comments.map((comment, index) => [comment.id, index]))
  const stillOpen = openQuestions.filter(
    (question) => (lastIndex.get(question.commentId) ?? 0) >= input.comments.length - 2,
  )

  const viewerAsked = input.comments.some(
    (comment) => comment.author === input.viewerName && QUESTION_CUE.test(comment.text),
  )
  const viewerAnswered =
    viewerAsked &&
    input.comments.some(
      (comment, index) =>
        comment.author !== input.viewerName &&
        index >
          input.comments.findIndex(
            (c) => c.author === input.viewerName && QUESTION_CUE.test(c.text),
          ),
    )

  return {
    decisions: decisions.slice(0, 8),
    openQuestions: stillOpen.slice(0, 8),
    commitments: commitments.slice(0, 10),
    forViewer:
      viewerAsked && !viewerAnswered
        ? VIEWER_LINE[input.locale](input.subject.title)
        : NOTHING_FOR_VIEWER,
  }
}

function validateOutput(
  input: SummarizeThreadInput,
  output: SummarizeThreadOutput,
): ValidateOutcome<SummarizeThreadOutput> {
  const ids = new Set(input.comments.map((comment) => comment.id))
  const authors = new Set(input.comments.map((comment) => comment.author))
  const order = new Map(input.comments.map((comment, index) => [comment.id, index]))

  const decisions = output.decisions
    .map((decision) => ({
      ...decision,
      commentIds: decision.commentIds.filter((id) => ids.has(id)),
    }))
    .filter((decision) => decision.commentIds.length > 0)
    .sort((a, b) => (order.get(a.commentIds[0]!) ?? 0) - (order.get(b.commentIds[0]!) ?? 0))

  const openQuestions = output.openQuestions
    .filter((question) => ids.has(question.commentId))
    .sort((a, b) => (order.get(a.commentId) ?? 0) - (order.get(b.commentId) ?? 0))

  // `who` is the one field where a near-miss is a real defect: "Nodira K." attributed to a
  // commitment nobody named Nodira K. made is a fabricated promise in an audit trail. An exact
  // author match is required; anything else drops the whole commitment.
  const commitments = output.commitments
    .filter((commitment) => ids.has(commitment.commentId) && authors.has(commitment.who))
    .sort((a, b) => (order.get(a.commentId) ?? 0) - (order.get(b.commentId) ?? 0))

  return {
    ok: true,
    output: { decisions, openQuestions, commitments, forViewer: output.forViewer },
  }
}

export const summarizeThreadSpec: FeatureSpec<SummarizeThreadInput, SummarizeThreadOutput> = {
  feature: 'summarize_thread',
  inputSchema: summarizeThreadInputSchema,
  outputSchema: summarizeThreadOutputSchema,
  toolName: 'emit_thread_summary',
  toolDescription:
    "Extract a discussion's outcome: what was decided, what is still open, who committed to what and by when — each attributed to the comment id it came from.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['decisions', 'openQuestions', 'commitments', 'forViewer'],
    properties: {
      decisions: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'commentIds'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 300 },
            commentIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
          },
        },
      },
      openQuestions: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'commentId'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 300 },
            commentId: { type: 'string' },
          },
        },
      },
      commitments: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['who', 'what', 'byWhen', 'commentId'],
          properties: {
            who: { type: 'string', maxLength: 200 },
            what: { type: 'string', minLength: 1, maxLength: 250 },
            byWhen: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            commentId: { type: 'string' },
          },
        },
      },
      forViewer: { type: 'string', maxLength: 250 },
    },
  },
  defaultMaxTokens: 1536,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

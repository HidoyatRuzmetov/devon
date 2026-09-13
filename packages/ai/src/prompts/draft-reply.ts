// N-1 draft_reply (v1.1 AI-AUDIT §4 "Add", SPEC §8). The single most-used AI action in every
// comparable product, and the one a junior xodim in this department has the clearest use for: the
// register of an administrative reply in Uzbek, Russian or English is genuinely hard to get right,
// and getting it wrong in a ministry is expensive.
//
// Hard rule, stated in the spec and enforced by the UI: the draft goes into the compose box. It is
// never posted. Nothing in this product ever writes into a thread or a Telegram chat without a human
// pressing send.
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

export const draftReplyInputSchema = z.object({
  locale: localeSchema,
  subject: z.object({
    kind: z.enum(['card', 'event', 'inbox']),
    id: idSchema,
    title: z.string().min(1).max(500),
  }),
  viewerName: z.string().min(1).max(200),
  /** head | member — a reply from the boshqarma boshligʻi carries different weight and is phrased
   * differently from a reply between colleagues. */
  viewerRole: z.enum(['head', 'member']),
  /** Chronological. The last one is what is being replied to. */
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
    .max(60),
  tone: z.enum(['neutral', 'formal', 'brief']).default('neutral'),
  /** What the person wants to say, in a few words, when they know. Empty means "read the thread and
   * answer what was asked". */
  intent: z.string().max(300).default(''),
})
export type DraftReplyInput = z.infer<typeof draftReplyInputSchema>

export const draftReplyOutputSchema = z.object({
  draft: z.string().min(1).max(1200),
  tone: z.enum(['neutral', 'formal', 'brief']),
  /** The comment ids this reply is actually answering — rendered above the draft so the person can
   * check it read the right message before sending anything. */
  answers: z.array(idSchema).max(3),
  /** Anything the thread asked that the draft could NOT answer because the answer is not in the
   * thread. Surfaced as a "you still need to say" chip, so the person does not send a polite
   * non-answer. */
  stillNeeded: z.array(z.string().max(160)).max(3),
})
export type DraftReplyOutput = z.infer<typeof draftReplyOutputSchema>

const FEW_SHOT = `comments: k3 Dilnoza "Anvar, vazirlik shaklini kim toʻldiradi?" | k4 Nodira "Men PDF-ni ertaga yuboraman."
viewerName "Anvar Aliyev", viewerRole "member", tone "neutral", intent "men toʻldiraman", locale uz-Latn
out: {"draft":"Dilnoza, vazirlik shaklini men toʻldiraman. Nodiraning PDF-i kelgach, ertaga yuboraman.","tone":"neutral","answers":["k3"],"stillNeeded":[]}

comments: k9 Boshliq "Hisobot qachon tayyor boʻladi?"
viewerName "Nodira Karimova", viewerRole "member", tone "formal", intent "", locale uz-Latn
out: {"draft":"Hurmatli boshqarma boshligʻi, hisobotning tayyor boʻlish muddatini aniqlab, bugun kun oxirigacha maʼlum qilaman.","tone":"formal","answers":["k9"],"stillNeeded":["Hisobotning aniq muddatini yozing"]}`

function systemPrompt(input: DraftReplyInput): string {
  const authors = [...new Set(input.comments.map((comment) => comment.author))]
  const toneRule =
    input.tone === 'formal'
      ? 'Formal: the register used when writing to a superior or to another ministry. Address the reader by their role, not their given name alone.'
      : input.tone === 'brief'
        ? 'Brief: one or two sentences, no opening formula, no sign-off.'
        : 'Neutral: how colleagues in the same unit write to each other — direct, polite, no formula.'
  return composePrompt({
    role: `You draft one reply in a ministry department's work discussion, on behalf of ${input.viewerName} (${input.viewerRole === 'head' ? 'the head of the department' : 'an employee'}). You write the message; a person reads it, edits it and decides whether to send it. You never send anything.`,
    inputs: `A JSON object: subject (a ${input.subject.kind} titled "${input.subject.title}"), viewerName, viewerRole, tone (${input.tone}), intent ("${input.intent || 'not given'}"), comments[] in chronological order.
People in this thread: ${authors.join(', ')}.`,
    instructions: [
      'Read the thread. Identify what is actually being asked of the writer, or what the intent says they want to communicate.',
      'Write `draft` as the message itself — nothing else. No "Here is a draft:", no subject line, no square-bracket placeholders.',
      toneRule,
      'Answer only what the thread supports. Never promise a date, a number or an outcome the writer did not state. If the writer has not said when something will be ready, do not invent a day — write that the date will follow, and put the missing piece in stillNeeded.',
      'answers: the ids of the comments this reply responds to, at most three.',
      'stillNeeded: short notes to the writer — not part of the message — naming what they must fill in before sending. Empty when the draft is complete.',
      'At most four sentences. A reply nobody reads to the end is a reply that did not work.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      "SHAPE. Never address anyone who is not in the thread. Never apologise on the writer's behalf for something they did not say they were sorry for. Never write a placeholder like [sana] or [ism].",
    ],
    examples: FEW_SHOT,
    toolName: 'emit_reply_draft',
  })
}

// -- Offline simulator ------------------------------------------------------------------------

type Phrases = {
  ack: (author: string, subject: string) => string
  withIntent: (author: string, intent: string) => string
  formalOpen: string
  willFollow: string
  needDate: string
  needDetail: string
}

const PHRASES: Record<Locale, Phrases> = {
  'uz-Latn': {
    ack: (author, subject) => `${author}, "${subject}" boʻyicha savolingizni koʻrdim.`,
    withIntent: (author, intent) => `${author}, ${intent}.`,
    formalOpen: 'Hurmatli hamkasb,',
    willFollow: 'Aniq maʼlumotni bugun kun oxirigacha yozaman.',
    needDate: 'Aniq muddatni yozing',
    needDetail: 'Javobingizning asosiy mazmunini qoʻshing',
  },
  'uz-Cyrl': {
    ack: (author, subject) => `${author}, "${subject}" бўйича саволингизни кўрдим.`,
    withIntent: (author, intent) => `${author}, ${intent}.`,
    formalOpen: 'Ҳурматли ҳамкасб,',
    willFollow: 'Аниқ маълумотни бугун кун охиригача ёзаман.',
    needDate: 'Аниқ муддатни ёзинг',
    needDetail: 'Жавобингизнинг асосий мазмунини қўшинг',
  },
  ru: {
    ack: (author, subject) => `${author}, видел(а) ваш вопрос по «${subject}».`,
    withIntent: (author, intent) => `${author}, ${intent}.`,
    formalOpen: 'Уважаемый коллега,',
    willFollow: 'Точную информацию сообщу до конца дня.',
    needDate: 'Укажите точный срок',
    needDetail: 'Добавьте суть вашего ответа',
  },
  en: {
    ack: (author, subject) => `${author}, I have seen your question about "${subject}".`,
    withIntent: (author, intent) => `${author}, ${intent}.`,
    formalOpen: 'Dear colleague,',
    willFollow: 'I will confirm the details by the end of the day.',
    needDate: 'State the actual deadline',
    needDetail: 'Add the substance of your answer',
  },
}

const QUESTION_CUE =
  /\?|\bkim\b|\bqachon\b|\bqanday\b|\bкто\b|\bкогда\b|\bкак\b|\bwho\b|\bwhen\b|\bhow\b/i

function simulate(input: DraftReplyInput): DraftReplyOutput {
  const p = PHRASES[input.locale]
  const incoming =
    [...input.comments].reverse().find((comment) => comment.author !== input.viewerName) ??
    input.comments[input.comments.length - 1]!

  const intent = input.intent.trim()
  const lines: string[] = []
  if (input.tone === 'formal') lines.push(p.formalOpen)
  lines.push(
    intent.length > 0
      ? p.withIntent(incoming.author, intent)
      : p.ack(incoming.author, input.subject.title),
  )
  if (input.tone !== 'brief') lines.push(p.willFollow)

  const stillNeeded: string[] = []
  if (intent.length === 0) stillNeeded.push(p.needDetail)
  if (QUESTION_CUE.test(incoming.text) && !/\d/.test(intent)) stillNeeded.push(p.needDate)

  return {
    draft: lines.join(' '),
    tone: input.tone,
    answers: [incoming.id],
    stillNeeded: stillNeeded.slice(0, 3),
  }
}

function validateOutput(
  input: DraftReplyInput,
  output: DraftReplyOutput,
): ValidateOutcome<DraftReplyOutput> {
  const ids = new Set(input.comments.map((comment) => comment.id))
  if (/\[[^\]]{2,40}\]|\{\{[^}]+\}\}|＿＿|___/.test(output.draft)) {
    return {
      ok: false,
      error:
        'The draft contains a placeholder. Write a complete sentence instead, and put whatever you cannot know into stillNeeded.',
    }
  }
  return {
    ok: true,
    output: {
      ...output,
      tone: input.tone,
      answers: output.answers.filter((id) => ids.has(id)).slice(0, 3),
    },
  }
}

export const draftReplySpec: FeatureSpec<DraftReplyInput, DraftReplyOutput> = {
  feature: 'draft_reply',
  inputSchema: draftReplyInputSchema,
  outputSchema: draftReplyOutputSchema,
  toolName: 'emit_reply_draft',
  toolDescription:
    "Draft one reply to a work discussion, in the register the writer's role calls for, answering only what the thread supports.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['draft', 'tone', 'answers', 'stillNeeded'],
    properties: {
      draft: { type: 'string', minLength: 1, maxLength: 1200 },
      tone: { type: 'string', enum: ['neutral', 'formal', 'brief'] },
      answers: { type: 'array', maxItems: 3, items: { type: 'string' } },
      stillNeeded: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 160 } },
    },
  },
  defaultMaxTokens: 1280,
  temperature: 0.3,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

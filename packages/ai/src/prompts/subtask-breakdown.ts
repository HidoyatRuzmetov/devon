// F2 subtask_breakdown (v1.1 AI-AUDIT §3 F2). The one v1.0 feature that worked end to end; v1.1
// keeps the shape and raises the ceiling:
//   * steps are objects, not bare strings -- each carries a working `estimateMin` and a
//     `needsApproval` flag, so the preview is a checklist a person unticks rather than a bullet list
//     they accept wholesale and then delete from.
//   * `insufficientInput` replaces silently inventing six steps for a card titled "Hisobot".
//   * the prompt knows how a Uzbek government office actually runs, which is the difference between
//     a generic "Plan / Do / Review" triple and a checklist a xodim recognises.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const ESTIMATE_BUCKETS = [15, 30, 60, 120, 240] as const

export const subtaskBreakdownInputSchema = z.object({
  locale: localeSchema,
  cardTitle: z.string().min(1).max(500),
  cardDescription: z.string().max(4000).nullable().default(null),
  existingSubtasks: z.array(z.string().min(1).max(500)).max(50).default([]),
  /** The card's labels, as domain hints ("EGDI", "hisobot"). */
  labels: z.array(z.string().min(1).max(80)).max(20).default([]),
  projectTitle: z.string().max(300).nullable().default(null),
  /** So steps can be sized against the time actually available. */
  dueInDays: z.number().int().min(-3650).max(3650).nullable().default(null),
  targetCount: z.number().int().min(2).max(12).default(6),
})
export type SubtaskBreakdownInput = z.infer<typeof subtaskBreakdownInputSchema>

export const subtaskBreakdownOutputSchema = z.object({
  subtasks: z
    .array(
      z.object({
        text: z.string().min(1).max(120),
        estimateMin: z.union([
          z.literal(15),
          z.literal(30),
          z.literal(60),
          z.literal(120),
          z.literal(240),
        ]),
        needsApproval: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
  insufficientInput: z.boolean(),
})
export type SubtaskBreakdownOutput = z.infer<typeof subtaskBreakdownOutputSchema>

const FEW_SHOT = `in : cardTitle "EGDI paketini tayyorlash", labels ["EGDI"], dueInDays 5, locale uz-Latn
out: {"subtasks":[
  {"text":"Boʻlimlardan EGDI koʻrsatkichlari boʻyicha maʼlumot yigʻish","estimateMin":120,"needsApproval":false},
  {"text":"Maʼlumotlarni jadvalga jamlash va tekshirish","estimateMin":60,"needsApproval":false},
  {"text":"Paket loyihasini yozish","estimateMin":240,"needsApproval":false},
  {"text":"Ichki koʻrib chiqishga yuborish","estimateMin":30,"needsApproval":false},
  {"text":"Boshqarma boshligʻi tasdigʻini olish","estimateMin":60,"needsApproval":true},
  {"text":"Vazirlik portaliga yuklash","estimateMin":30,"needsApproval":false}],
  "insufficientInput":false}

in : cardTitle "Hisobot", cardDescription null, locale uz-Latn
out: {"subtasks":[{"text":"Qaysi hisobot va qaysi davr uchun ekanini aniqlashtirish","estimateMin":15,"needsApproval":false}],"insufficientInput":true}`

function systemPrompt(input: SubtaskBreakdownInput): string {
  return composePrompt({
    role: 'You break one work item of a ministry department into an ordered checklist of concrete steps. You know how Uzbek government office work runs: data is gathered from the boʻlim, a draft is written, it is reviewed internally, the boshqarma boshligʻi approves it, then it is submitted to the ministry and archived.',
    inputs: `A JSON object: cardTitle, cardDescription, existingSubtasks (steps that already exist — never repeat them), labels, projectTitle, dueInDays, targetCount (${input.targetCount}).`,
    instructions: [
      `Produce about ${input.targetCount} steps (±2), in the order they must actually be done.`,
      'Each step is a verb-first phrase of at most 80 characters, naming one deliverable, tickable on its own.',
      'Never restate the card title as a step. Never duplicate anything in existingSubtasks, even paraphrased.',
      'Give every step an estimateMin from exactly {15, 30, 60, 120, 240} — a working estimate, not a promise.',
      'Set needsApproval true on any step that requires the boshqarma boshligʻi to sign off.',
      'If cardDescription is empty and the title is too vague to break down (fewer than four words and no verb), return exactly ONE step that asks for the missing detail, and set insufficientInput true.',
      'If dueInDays is small, prefer fewer, larger steps; a six-step checklist for tomorrow is not a plan.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'SHAPE. Never name a person. Never invent a deadline. Never mention a document, system or department that the title, description or labels did not name.',
    ],
    examples: FEW_SHOT,
    toolName: 'emit_subtasks',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// v1.0 split the description on punctuation and, failing that, emitted three hard-coded ENGLISH
// strings that rendered inside an Uzbek UI (AI-AUDIT §5 fix 19). v1.1 uses the real ministry
// workflow, in the caller's own language, built from the card's own title.

type StepTemplate = {
  key: string
  estimateMin: (typeof ESTIMATE_BUCKETS)[number]
  needsApproval: boolean
}

const WORKFLOW: readonly StepTemplate[] = [
  { key: 'gather', estimateMin: 120, needsApproval: false },
  { key: 'draft', estimateMin: 240, needsApproval: false },
  { key: 'review', estimateMin: 60, needsApproval: false },
  { key: 'approve', estimateMin: 60, needsApproval: true },
  { key: 'submit', estimateMin: 30, needsApproval: false },
  { key: 'archive', estimateMin: 15, needsApproval: false },
]

const STEP_TEXT: Record<string, Record<Locale, string>> = {
  gather: {
    'uz-Latn': 'Boʻlimlardan kerakli maʼlumotlarni yigʻish',
    'uz-Cyrl': 'Бўлимлардан керакли маълумотларни йиғиш',
    ru: 'Собрать необходимые данные в отделах',
    en: 'Gather the required data from the units',
  },
  draft: {
    'uz-Latn': 'Loyihani yozish',
    'uz-Cyrl': 'Лойиҳани ёзиш',
    ru: 'Подготовить проект документа',
    en: 'Write the draft',
  },
  review: {
    'uz-Latn': 'Ichki koʻrib chiqishga yuborish',
    'uz-Cyrl': 'Ички кўриб чиқишга юбориш',
    ru: 'Отправить на внутреннее рассмотрение',
    en: 'Send for internal review',
  },
  approve: {
    'uz-Latn': 'Boshqarma boshligʻi tasdigʻini olish',
    'uz-Cyrl': 'Бошқарма бошлиғи тасдиғини олиш',
    ru: 'Получить утверждение начальника управления',
    en: 'Get the head of department to approve it',
  },
  submit: {
    'uz-Latn': 'Vazirlikka yuborish',
    'uz-Cyrl': 'Вазирликка юбориш',
    ru: 'Направить в министерство',
    en: 'Submit to the ministry',
  },
  archive: {
    'uz-Latn': 'Natijani arxivga joylash',
    'uz-Cyrl': 'Натижани архивга жойлаш',
    ru: 'Поместить результат в архив',
    en: 'File the result',
  },
}

const CLARIFY: Record<Locale, string> = {
  'uz-Latn': 'Vazifa nimadan iboratligini va muddatini aniqlashtirish',
  'uz-Cyrl': 'Вазифа нимадан иборатлигини ва муддатини аниқлаштириш',
  ru: 'Уточнить, в чём состоит задача и каков срок',
  en: 'Clarify what the task actually is and by when',
}

function bucket(minutes: number): (typeof ESTIMATE_BUCKETS)[number] {
  return ESTIMATE_BUCKETS.reduce((best, candidate) =>
    Math.abs(candidate - minutes) < Math.abs(best - minutes) ? candidate : best,
  )
}

function simulate(input: SubtaskBreakdownInput): SubtaskBreakdownOutput {
  const words = input.cardTitle.trim().split(/\s+/).filter(Boolean)
  // "Hisobot" alone is unbreakable; "EGDI paketini tayyorlash" is not. Two words is the honest
  // offline line -- the real model is asked the sharper question ("fewer than four words and no
  // verb"), which it can actually judge.
  const vague = (input.cardDescription ?? '').trim().length === 0 && words.length < 3
  if (vague) {
    return {
      subtasks: [{ text: CLARIFY[input.locale], estimateMin: 15, needsApproval: false }],
      insufficientInput: true,
    }
  }

  // A description with real sentences is the best signal available offline: each sentence is a step.
  const sentences = (input.cardDescription ?? '')
    .split(/[.\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, input.targetCount)

  const existing = new Set(input.existingSubtasks.map((s) => s.trim().toLowerCase()))
  const fromDescription = sentences.map((sentence) => ({
    text: sentence.slice(0, 120),
    estimateMin: bucket(Math.max(15, Math.min(240, sentence.length * 2))),
    needsApproval: /tasdiq|утвержд|approv|boshliq|бошлиқ/i.test(sentence),
  }))

  const workflow = WORKFLOW.slice(0, input.targetCount).map((step) => ({
    text: STEP_TEXT[step.key]![input.locale],
    estimateMin:
      input.dueInDays !== null && input.dueInDays <= 2
        ? bucket(step.estimateMin / 2)
        : step.estimateMin,
    needsApproval: step.needsApproval,
  }))

  const candidates = fromDescription.length >= 3 ? fromDescription : workflow
  const subtasks = candidates
    .filter((step) => !existing.has(step.text.trim().toLowerCase()))
    .slice(0, Math.min(20, input.targetCount + 2))

  return {
    subtasks:
      subtasks.length > 0
        ? subtasks
        : [{ text: CLARIFY[input.locale], estimateMin: 15, needsApproval: false }],
    insufficientInput: false,
  }
}

function validateOutput(
  input: SubtaskBreakdownInput,
  output: SubtaskBreakdownOutput,
): ValidateOutcome<SubtaskBreakdownOutput> {
  const title = input.cardTitle.trim().toLowerCase()
  const existing = new Set(input.existingSubtasks.map((s) => s.trim().toLowerCase()))
  const seen = new Set<string>()
  const kept = output.subtasks.filter((step) => {
    const key = step.text.trim().toLowerCase()
    if (key === title) return false
    if (existing.has(key)) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (kept.length === 0) {
    return {
      ok: false,
      error:
        'Every step you returned duplicated the card title or an existing checklist item. Produce genuinely new steps.',
    }
  }
  if (output.insufficientInput && kept.length !== 1) {
    return {
      ok: true,
      output: { subtasks: [kept[0]!], insufficientInput: true },
    }
  }
  return { ok: true, output: { ...output, subtasks: kept } }
}

export const subtaskBreakdownSpec: FeatureSpec<SubtaskBreakdownInput, SubtaskBreakdownOutput> = {
  feature: 'subtask_breakdown',
  inputSchema: subtaskBreakdownInputSchema,
  outputSchema: subtaskBreakdownOutputSchema,
  toolName: 'emit_subtasks',
  toolDescription:
    'Emit an ordered checklist of concrete steps for one work item, each with a working time estimate and whether it needs the head of department to sign off.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['subtasks', 'insufficientInput'],
    properties: {
      subtasks: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'estimateMin', 'needsApproval'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 120 },
            estimateMin: { type: 'integer', enum: [15, 30, 60, 120, 240] },
            needsApproval: { type: 'boolean' },
          },
        },
      },
      insufficientInput: { type: 'boolean' },
    },
  },
  defaultMaxTokens: 1280,
  temperature: 0.2,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

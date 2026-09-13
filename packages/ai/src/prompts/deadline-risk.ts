// F4 deadline_risk (v1.1 AI-AUDIT §3 F4, D-4). Demoted from classifier to explainer.
//
// `apps/api/src/modules/work/repo.ts`'s `computeRisk()` already decides none | at_risk | overdue,
// deterministically, for free, on every card. v1.0 shipped a *second* classifier with a different
// vocabulary (low/medium/high) that no screen ever called. Two sources of truth for "is this card at
// risk" is a defect. So the level now travels IN, the model may not change it, and what it adds is
// the one thing it is genuinely better at: saying why this specific card is stuck, and proposing the
// one next step the product can actually perform.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { idSchema, isoDateSchema, localeSchema, riskLevelSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

/** Exactly the five things the card detail screen can do on the user's behalf, plus "nothing". The
 * model chooses one of these and the UI wires Accept straight to it -- this is the one AI surface
 * where Accept *is* the action, not a copy step. */
export const riskActionKindSchema = z.enum([
  'move_due_date',
  'ping_assignee',
  'split_into_subtasks',
  'reassign',
  'mark_blocked',
  'none',
])
export type RiskActionKind = z.infer<typeof riskActionKindSchema>

export const deadlineRiskCardSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
  /** Computed by `computeRisk()`. Never re-decided here. */
  riskLevel: riskLevelSchema,
  dueDate: isoDateSchema.nullable(),
  today: isoDateSchema,
  checklistTotal: z.number().int().min(0).max(1000),
  checklistDone: z.number().int().min(0).max(1000),
  daysSinceUpdate: z.number().int().min(0).max(10_000),
  assigneeName: z.string().max(200).nullable().default(null),
  commentCount: z.number().int().min(0).max(10_000).default(0),
  blockedByTitles: z.array(z.string().min(1).max(500)).max(10).default([]),
  /** How many of this assignee's last ten closed cards slipped. Raises urgency; never becomes a
   * statement about the person. */
  similarSlippedCount: z.number().int().min(0).max(10).default(0),
})

export const deadlineRiskInputSchema = z.object({
  locale: localeSchema,
  card: deadlineRiskCardSchema,
})
export type DeadlineRiskInput = z.infer<typeof deadlineRiskInputSchema>

export const deadlineRiskOutputSchema = z.object({
  riskLevel: riskLevelSchema,
  headline: z.string().min(1).max(90),
  explanation: z.string().min(1).max(500),
  actionKind: riskActionKindSchema,
  actionLabel: z.string().min(1).max(80),
  actionPayload: z.object({ suggestedDueDate: isoDateSchema.nullable() }),
})
export type DeadlineRiskOutput = z.infer<typeof deadlineRiskOutputSchema>

const FEW_SHOT = `in : riskLevel "overdue", title "Choraklik hisobot", dueDate 2026-09-01, today 2026-09-08, checklist 1/4, daysSinceUpdate 10, assigneeName "Nodira Karimova", blockedByTitles []
out: {"riskLevel":"overdue","headline":"7 kun kechikdi va 10 kundan beri harakat yoʻq",
 "explanation":"Muddat 1-sentabrda tugagan. Roʻyxatning 4 tadan 1 tasi bajarilgan, oxirgi oʻzgarish 10 kun oldin. Bu holatda muddatni koʻchirmasdan yopish qiyin.",
 "actionKind":"move_due_date","actionLabel":"Muddatni 15-sentabrga koʻchirish","actionPayload":{"suggestedDueDate":"2026-09-15"}}

in : riskLevel "at_risk", blockedByTitles ["Vazirlik javobini kutish"]
out: {"riskLevel":"at_risk","headline":"Boshqa vazifa tomonidan bloklangan",
 "explanation":"Bu vazifa \\"Vazirlik javobini kutish\\" tugamaguncha davom eta olmaydi.",
 "actionKind":"mark_blocked","actionLabel":"Bloklangan deb belgilash","actionPayload":{"suggestedDueDate":null}}

in : riskLevel "none", checklist 4/4, daysSinceUpdate 1
out: {"riskLevel":"none","headline":"Vazifa reja boʻyicha ketyapti","explanation":"Roʻyxatning barcha 4 bandi bajarilgan va kecha yangilangan.","actionKind":"none","actionLabel":"Hozircha chora kerak emas","actionPayload":{"suggestedDueDate":null}}`

function systemPrompt(input: DeadlineRiskInput): string {
  const { card } = input
  const pct =
    card.checklistTotal > 0 ? Math.round((card.checklistDone / card.checklistTotal) * 100) : null
  return composePrompt({
    role: 'You explain, in one short paragraph, why a specific work item of a ministry department is at risk of missing its deadline, and you propose exactly one next step. The risk level has already been decided by the system; do not change it and do not second-guess it.',
    inputs: `A JSON object with one card: id, title, riskLevel (${card.riskLevel} — already decided), dueDate, today (${card.today}), checklistDone/checklistTotal (${card.checklistDone}/${card.checklistTotal}${pct === null ? '' : `, i.e. ${pct}%`}), daysSinceUpdate (${card.daysSinceUpdate}), assigneeName, commentCount, blockedByTitles, similarSlippedCount.`,
    instructions: [
      'Open with the single most decisive fact — days overdue, or the stall, or the blocker. Never restate every input.',
      'Use exact numbers. Never state a percentage you did not compute from checklistDone/checklistTotal, and never state a day count you did not compute from dueDate and today.',
      'If blockedByTitles is not empty, the blocker is the reason. Say so, name it, and choose actionKind "mark_blocked".',
      'Choose actionKind from the six allowed values only — never propose something this product cannot do. "move_due_date" needs a suggestedDueDate strictly after today; every other kind has suggestedDueDate null.',
      'actionLabel is the button the person will press, phrased as an imperative with the concrete value in it ("Muddatni 15-sentabrga koʻchirish").',
      'When riskLevel is "none", actionKind must be "none" and the explanation simply says the item is on track.',
      'Never blame a person. Describe the state of the work, never the character or diligence of whoever it is assigned to.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      TONE_CONSTRAINT,
      `SHAPE. riskLevel in your answer MUST be exactly "${card.riskLevel}". Never mention similarSlippedCount as a judgement about anybody — use it only to decide how urgent your wording is.`,
    ],
    examples: FEW_SHOT,
    toolName: 'emit_deadline_risk',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// Locale-aware, numeric, and consistent with the deterministic badge. The mock here is genuinely
// close to the real answer for the classification (which is the point of D-4) and honestly worse for
// the prose, which is exactly the split v1.1 designed for.

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  )
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

type Phrases = {
  overdueHeadline: (days: number, stale: number) => string
  atRiskHeadline: (days: number) => string
  blockedHeadline: string
  okHeadline: string
  explanationOverdue: (days: number, done: number, total: number, stale: number) => string
  explanationAtRisk: (days: number, done: number, total: number) => string
  explanationBlocked: (title: string) => string
  explanationOk: (done: number, total: number, stale: number) => string
  moveLabel: (date: string) => string
  blockedLabel: string
  splitLabel: string
  pingLabel: string
  noneLabel: string
}

const PHRASES: Record<Locale, Phrases> = {
  'uz-Latn': {
    overdueHeadline: (d, s) => `${d} kun kechikdi va ${s} kundan beri harakat yoʻq`,
    atRiskHeadline: (d) => `Muddatga ${d} kun qoldi`,
    blockedHeadline: 'Boshqa vazifa tomonidan bloklangan',
    okHeadline: 'Vazifa reja boʻyicha ketyapti',
    explanationOverdue: (d, done, total, s) =>
      `Muddat ${d} kun oldin tugagan. Roʻyxatning ${total} tadan ${done} tasi bajarilgan, oxirgi oʻzgarish ${s} kun oldin.`,
    explanationAtRisk: (d, done, total) =>
      `Muddatga ${d} kun qoldi, roʻyxatning ${total} tadan ${done} tasi bajarilgan.`,
    explanationBlocked: (title) => `Bu vazifa "${title}" tugamaguncha davom eta olmaydi.`,
    explanationOk: (done, total, s) =>
      `Roʻyxatning ${total} tadan ${done} tasi bajarilgan, oxirgi oʻzgarish ${s} kun oldin.`,
    moveLabel: (date) => `Muddatni ${date} ga koʻchirish`,
    blockedLabel: 'Bloklangan deb belgilash',
    splitLabel: 'Kichik qadamlarga boʻlish',
    pingLabel: 'Masʼulga eslatma yuborish',
    noneLabel: 'Hozircha chora kerak emas',
  },
  'uz-Cyrl': {
    overdueHeadline: (d, s) => `${d} кун кечикди ва ${s} кундан бери ҳаракат йўқ`,
    atRiskHeadline: (d) => `Муддатга ${d} кун қолди`,
    blockedHeadline: 'Бошқа вазифа томонидан блокланган',
    okHeadline: 'Вазифа режа бўйича кетяпти',
    explanationOverdue: (d, done, total, s) =>
      `Муддат ${d} кун олдин тугаган. Рўйхатнинг ${total} тадан ${done} таси бажарилган, охирги ўзгариш ${s} кун олдин.`,
    explanationAtRisk: (d, done, total) =>
      `Муддатга ${d} кун қолди, рўйхатнинг ${total} тадан ${done} таси бажарилган.`,
    explanationBlocked: (title) => `Бу вазифа "${title}" тугамагунча давом эта олмайди.`,
    explanationOk: (done, total, s) =>
      `Рўйхатнинг ${total} тадан ${done} таси бажарилган, охирги ўзгариш ${s} кун олдин.`,
    moveLabel: (date) => `Муддатни ${date} га кўчириш`,
    blockedLabel: 'Блокланган деб белгилаш',
    splitLabel: 'Кичик қадамларга бўлиш',
    pingLabel: 'Масъулга эслатма юбориш',
    noneLabel: 'Ҳозирча чора керак эмас',
  },
  ru: {
    overdueHeadline: (d, s) => `Просрочено на ${d} дн., без движения ${s} дн.`,
    atRiskHeadline: (d) => `До срока осталось ${d} дн.`,
    blockedHeadline: 'Заблокировано другой задачей',
    okHeadline: 'Задача идёт по плану',
    explanationOverdue: (d, done, total, s) =>
      `Срок истёк ${d} дн. назад. Выполнено ${done} из ${total} пунктов, последнее изменение ${s} дн. назад.`,
    explanationAtRisk: (d, done, total) =>
      `До срока ${d} дн., выполнено ${done} из ${total} пунктов.`,
    explanationBlocked: (title) => `Задача не может продолжаться, пока не закрыта «${title}».`,
    explanationOk: (done, total, s) =>
      `Выполнено ${done} из ${total} пунктов, последнее изменение ${s} дн. назад.`,
    moveLabel: (date) => `Перенести срок на ${date}`,
    blockedLabel: 'Отметить как заблокированную',
    splitLabel: 'Разбить на шаги',
    pingLabel: 'Напомнить исполнителю',
    noneLabel: 'Действий пока не требуется',
  },
  en: {
    overdueHeadline: (d, s) => `${d} days late, ${s} days without movement`,
    atRiskHeadline: (d) => `${d} days left before the deadline`,
    blockedHeadline: 'Blocked by another item',
    okHeadline: 'This item is on track',
    explanationOverdue: (d, done, total, s) =>
      `The deadline passed ${d} days ago. ${done} of ${total} checklist items are done; last change ${s} days ago.`,
    explanationAtRisk: (d, done, total) =>
      `${d} days left, ${done} of ${total} checklist items done.`,
    explanationBlocked: (title) => `This cannot move until "${title}" is closed.`,
    explanationOk: (done, total, s) =>
      `${done} of ${total} checklist items are done; last change ${s} days ago.`,
    moveLabel: (date) => `Move the deadline to ${date}`,
    blockedLabel: 'Mark as blocked',
    splitLabel: 'Break it into smaller steps',
    pingLabel: 'Remind the assignee',
    noneLabel: 'No action needed yet',
  },
}

function simulate(input: DeadlineRiskInput): DeadlineRiskOutput {
  const { card } = input
  const p = PHRASES[input.locale]
  const blocker = card.blockedByTitles[0]
  const daysLeft = card.dueDate ? daysBetween(card.today, card.dueDate) : null
  const daysOverdue = daysLeft !== null && daysLeft < 0 ? -daysLeft : 0

  if (blocker) {
    return {
      riskLevel: card.riskLevel,
      headline: p.blockedHeadline,
      explanation: p.explanationBlocked(blocker),
      actionKind: 'mark_blocked',
      actionLabel: p.blockedLabel,
      actionPayload: { suggestedDueDate: null },
    }
  }

  if (card.riskLevel === 'none') {
    return {
      riskLevel: 'none',
      headline: p.okHeadline,
      explanation: p.explanationOk(card.checklistDone, card.checklistTotal, card.daysSinceUpdate),
      actionKind: 'none',
      actionLabel: p.noneLabel,
      actionPayload: { suggestedDueDate: null },
    }
  }

  if (card.riskLevel === 'overdue') {
    // A week of slack plus one day per day already lost, so the suggestion is honest rather than
    // optimistic -- and always strictly after today, which `validateOutput` enforces anyway.
    const suggested = addDays(card.today, Math.min(21, 7 + Math.ceil(daysOverdue / 2)))
    return {
      riskLevel: 'overdue',
      headline: p.overdueHeadline(daysOverdue, card.daysSinceUpdate),
      explanation: p.explanationOverdue(
        daysOverdue,
        card.checklistDone,
        card.checklistTotal,
        card.daysSinceUpdate,
      ),
      actionKind: 'move_due_date',
      actionLabel: p.moveLabel(suggested),
      actionPayload: { suggestedDueDate: suggested },
    }
  }

  const stalled = card.daysSinceUpdate >= 5
  const barelyStarted = card.checklistTotal > 0 && card.checklistDone / card.checklistTotal < 0.34
  return {
    riskLevel: 'at_risk',
    headline: p.atRiskHeadline(Math.max(0, daysLeft ?? 0)),
    explanation: p.explanationAtRisk(
      Math.max(0, daysLeft ?? 0),
      card.checklistDone,
      card.checklistTotal,
    ),
    actionKind: stalled ? 'ping_assignee' : barelyStarted ? 'split_into_subtasks' : 'ping_assignee',
    actionLabel: stalled ? p.pingLabel : barelyStarted ? p.splitLabel : p.pingLabel,
    actionPayload: { suggestedDueDate: null },
  }
}

function validateOutput(
  input: DeadlineRiskInput,
  output: DeadlineRiskOutput,
): ValidateOutcome<DeadlineRiskOutput> {
  if (output.riskLevel !== input.card.riskLevel) {
    return {
      ok: false,
      error: `riskLevel must be exactly "${input.card.riskLevel}" — the system already decided it and you may not change it.`,
    }
  }
  if (input.card.riskLevel === 'none' && output.actionKind !== 'none') {
    return {
      ok: true,
      output: { ...output, actionKind: 'none', actionPayload: { suggestedDueDate: null } },
    }
  }
  if (output.actionKind === 'move_due_date') {
    const suggested = output.actionPayload.suggestedDueDate
    if (suggested === null || suggested <= input.card.today) {
      return {
        ok: false,
        error:
          'actionKind "move_due_date" requires actionPayload.suggestedDueDate to be a date strictly after today.',
      }
    }
  } else if (output.actionPayload.suggestedDueDate !== null) {
    return { ok: true, output: { ...output, actionPayload: { suggestedDueDate: null } } }
  }
  if (input.card.blockedByTitles.length > 0 && output.actionKind !== 'mark_blocked') {
    return {
      ok: true,
      output: { ...output, actionKind: 'mark_blocked', actionPayload: { suggestedDueDate: null } },
    }
  }
  return { ok: true, output }
}

export const deadlineRiskSpec: FeatureSpec<DeadlineRiskInput, DeadlineRiskOutput> = {
  feature: 'deadline_risk',
  inputSchema: deadlineRiskInputSchema,
  outputSchema: deadlineRiskOutputSchema,
  toolName: 'emit_deadline_risk',
  toolDescription:
    'Explain why one work item carries the risk level the system already assigned it, and propose exactly one next step this product can perform.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [
      'riskLevel',
      'headline',
      'explanation',
      'actionKind',
      'actionLabel',
      'actionPayload',
    ],
    properties: {
      riskLevel: { type: 'string', enum: ['none', 'at_risk', 'overdue'] },
      headline: { type: 'string', minLength: 1, maxLength: 90 },
      explanation: { type: 'string', minLength: 1, maxLength: 500 },
      actionKind: {
        type: 'string',
        enum: [
          'move_due_date',
          'ping_assignee',
          'split_into_subtasks',
          'reassign',
          'mark_blocked',
          'none',
        ],
      },
      actionLabel: { type: 'string', minLength: 1, maxLength: 80 },
      actionPayload: {
        type: 'object',
        additionalProperties: false,
        required: ['suggestedDueDate'],
        properties: {
          suggestedDueDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  },
  defaultMaxTokens: 1024,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

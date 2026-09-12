// N-2 board_risk_digest (v1.1 AI-AUDIT §4 "Add", SPEC §8). The head's daily version of F4:
// "Kim kechiktiryapti?" over the whole board.
//
// The point is the *batching*. Running `deadline_risk` over the top twenty at-risk cards would be
// twenty calls, twenty traces and twenty times the cost; this is one call with an array in and a
// ranked array out. The risk level of each card still arrives already decided by `computeRisk()` —
// the model ranks and explains, it never classifies.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  CITATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { idSchema, isoDateSchema, localeSchema, riskLevelSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const boardRiskDigestInputSchema = z.object({
  locale: localeSchema,
  departmentName: z.string().min(1).max(300),
  today: isoDateSchema,
  cards: z
    .array(
      z.object({
        id: idSchema,
        title: z.string().min(1).max(500),
        riskLevel: riskLevelSchema,
        assigneeName: z.string().max(200).nullable().default(null),
        dueDate: isoDateSchema.nullable().default(null),
        daysOverdue: z.number().int().min(0).max(10_000).default(0),
        daysSinceUpdate: z.number().int().min(0).max(10_000).default(0),
        checklistDone: z.number().int().min(0).max(1000).default(0),
        checklistTotal: z.number().int().min(0).max(1000).default(0),
        blocked: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(40),
  /** Open items per person, so the digest can say *why* a card is stuck rather than only that it is. */
  loadPerPerson: z
    .array(z.object({ name: z.string().min(1).max(200), openCount: z.number().int().min(0) }))
    .max(100)
    .default([]),
  /** How many rows the head asked for. */
  topN: z.number().int().min(1).max(10).default(5),
})
export type BoardRiskDigestInput = z.infer<typeof boardRiskDigestInputSchema>

export const boardRiskDigestOutputSchema = z.object({
  headline: z.string().min(1).max(200),
  entries: z
    .array(
      z.object({
        cardId: idSchema,
        rank: z.number().int().min(1).max(10),
        reason: z.string().min(1).max(200),
        /** One of the five things the board can do about it, so each row carries a real button. */
        suggestedAction: z.enum([
          'move_due_date',
          'ping_assignee',
          'split_into_subtasks',
          'reassign',
          'mark_blocked',
        ]),
      }),
    )
    .max(10),
  /** At most two people whose load is the structural cause. Workload, never performance. */
  pressurePoints: z
    .array(z.object({ name: z.string().min(1).max(200), text: z.string().max(200) }))
    .max(2),
})
export type BoardRiskDigestOutput = z.infer<typeof boardRiskDigestOutputSchema>

const FEW_SHOT = `today 2026-09-12, topN 3, locale uz-Latn
cards: c9 "EGDI paketi" overdue Nodira 5 kun kechikkan, 9 kun oʻzgarmagan, 1/4 | c4 "Byudjet jadvali" at_risk Anvar due 2026-09-14, 0/3 | c7 "Sayt matni" at_risk Anvar due 2026-09-15, 2/3, blocked
loadPerPerson: Anvar 9, Nodira 4
out: {"headline":"Uchta vazifa muddatidan chiqishi mumkin — ikkitasi Anvarda.",
 "entries":[{"cardId":"c9","rank":1,"reason":"5 kun kechikdi va 9 kundan beri hech kim tegmagan","suggestedAction":"move_due_date"},
            {"cardId":"c7","rank":2,"reason":"Bloklangan, muddatga uch kun qoldi","suggestedAction":"mark_blocked"},
            {"cardId":"c4","rank":3,"reason":"Ikki kun qoldi, roʻyxatdan hech nima bajarilmagan","suggestedAction":"split_into_subtasks"}],
 "pressurePoints":[{"name":"Anvar","text":"Anvarda 9 ta ochiq vazifa bor — xavfli ikkitasi ham unda."}]}`

function systemPrompt(input: BoardRiskDigestInput): string {
  return composePrompt({
    role: `You brief the head of "${input.departmentName}" on which work items are actually going to slip. You rank, you explain in one line each, and you propose one action per item. The risk level of every item has already been decided by the system; you never change it.`,
    inputs: `A JSON object: departmentName, today (${input.today}), topN (${input.topN}), cards[] each with id, title, riskLevel, assigneeName, dueDate, daysOverdue, daysSinceUpdate, checklistDone/checklistTotal, blocked; and loadPerPerson[].`,
    instructions: [
      `Rank the ${input.topN} items most likely to slip. Rank 1 is the most urgent. Never return more than topN entries.`,
      'Rank by: overdue days first, then days without any change, then how little of the checklist is done, then how close the deadline is. A blocked item outranks an unblocked one with the same numbers.',
      'reason: one line, at most 90 characters, naming the concrete numbers ("5 kun kechikdi va 9 kundan beri hech kim tegmagan"). Never "muhim vazifa" or any other filler.',
      'suggestedAction: mark_blocked when the item is blocked; move_due_date when it is already overdue and stalled; split_into_subtasks when the deadline is close and almost nothing is ticked; ping_assignee when it is merely quiet; reassign only when one person holds several of the top entries and another clearly has room.',
      'headline: one sentence naming how many items are at risk and, when it is true, the single fact behind it ("ikkitasi Anvarda").',
      'pressurePoints: at most two people, from loadPerPerson only, whose open count explains the pattern. Phrase it as workload. Never as performance, diligence or ability.',
      'Items you do not rank are simply absent — never pad the list to reach topN.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      CITATION_CONSTRAINT,
      TONE_CONSTRAINT,
      'PEOPLE. Name only the people who appear as an assigneeName or in loadPerPerson.',
    ],
    examples: FEW_SHOT,
    toolName: 'emit_board_risk_digest',
  })
}

// -- Offline simulator ------------------------------------------------------------------------

type Phrases = {
  headline: (count: number) => string
  headlineWithPerson: (count: number, name: string, n: number) => string
  overdueStale: (days: number, stale: number) => string
  blockedSoon: (days: number) => string
  closeAndEmpty: (days: number) => string
  quiet: (stale: number) => string
  pressure: (name: string, open: number) => string
  none: string
}

const PHRASES: Record<Locale, Phrases> = {
  'uz-Latn': {
    headline: (count) => `${count} ta vazifa muddatidan chiqishi mumkin.`,
    headlineWithPerson: (count, name, n) =>
      `${count} ta vazifa muddatidan chiqishi mumkin — ${n} tasi ${name}da.`,
    overdueStale: (days, stale) => `${days} kun kechikdi va ${stale} kundan beri hech kim tegmagan`,
    blockedSoon: (days) => `Bloklangan, muddatga ${days} kun qoldi`,
    closeAndEmpty: (days) => `${days} kun qoldi, roʻyxatdan deyarli hech nima bajarilmagan`,
    quiet: (stale) => `${stale} kundan beri oʻzgarish yoʻq`,
    pressure: (name, open) => `${name}da ${open} ta ochiq vazifa bor — eng katta yuk.`,
    none: 'Hozircha muddatidan chiqadigan vazifa yoʻq.',
  },
  'uz-Cyrl': {
    headline: (count) => `${count} та вазифа муддатидан чиқиши мумкин.`,
    headlineWithPerson: (count, name, n) =>
      `${count} та вазифа муддатидан чиқиши мумкин — ${n} таси ${name}да.`,
    overdueStale: (days, stale) => `${days} кун кечикди ва ${stale} кундан бери ҳеч ким тегмаган`,
    blockedSoon: (days) => `Блокланган, муддатга ${days} кун қолди`,
    closeAndEmpty: (days) => `${days} кун қолди, рўйхатдан деярли ҳеч нима бажарилмаган`,
    quiet: (stale) => `${stale} кундан бери ўзгариш йўқ`,
    pressure: (name, open) => `${name}да ${open} та очиқ вазифа бор — энг катта юк.`,
    none: 'Ҳозирча муддатидан чиқадиган вазифа йўқ.',
  },
  ru: {
    headline: (count) => `${count} задач(и) могут выйти за срок.`,
    headlineWithPerson: (count, name, n) =>
      `${count} задач(и) могут выйти за срок — ${n} из них у ${name}.`,
    overdueStale: (days, stale) => `Просрочено на ${days} дн., без изменений ${stale} дн.`,
    blockedSoon: (days) => `Заблокировано, до срока ${days} дн.`,
    closeAndEmpty: (days) => `До срока ${days} дн., по чек-листу почти ничего не сделано`,
    quiet: (stale) => `Без изменений ${stale} дн.`,
    pressure: (name, open) => `У ${name} ${open} открытых задач — самая большая нагрузка.`,
    none: 'Пока нет задач, которые выйдут за срок.',
  },
  en: {
    headline: (count) => `${count} item(s) are likely to slip.`,
    headlineWithPerson: (count, name, n) =>
      `${count} item(s) are likely to slip — ${n} of them with ${name}.`,
    overdueStale: (days, stale) => `${days} days late and untouched for ${stale} days`,
    blockedSoon: (days) => `Blocked, ${days} days before the deadline`,
    closeAndEmpty: (days) => `${days} days left and almost nothing ticked off`,
    quiet: (stale) => `No change for ${stale} days`,
    pressure: (name, open) => `${name} carries ${open} open items — the heaviest load.`,
    none: 'Nothing is heading past its deadline right now.',
  },
}

function daysUntil(today: string, due: string | null): number {
  if (!due) return 999
  return Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
}

function simulate(input: BoardRiskDigestInput): BoardRiskDigestOutput {
  const p = PHRASES[input.locale]
  const risky = input.cards.filter((card) => card.riskLevel !== 'none')
  if (risky.length === 0) {
    return { headline: p.none, entries: [], pressurePoints: [] }
  }

  const score = (card: BoardRiskDigestInput['cards'][number]): number => {
    const progress = card.checklistTotal > 0 ? card.checklistDone / card.checklistTotal : 0.5
    return (
      card.daysOverdue * 1000 +
      card.daysSinceUpdate * 40 +
      (card.blocked ? 300 : 0) +
      Math.max(0, 30 - daysUntil(input.today, card.dueDate)) * 20 +
      Math.round((1 - progress) * 100)
    )
  }

  const ranked = [...risky].sort((a, b) => score(b) - score(a)).slice(0, input.topN)

  const entries = ranked.map((card, index) => {
    const left = daysUntil(input.today, card.dueDate)
    const progress = card.checklistTotal > 0 ? card.checklistDone / card.checklistTotal : 1
    let reason: string
    let suggestedAction: BoardRiskDigestOutput['entries'][number]['suggestedAction']
    if (card.blocked) {
      reason = p.blockedSoon(Math.max(0, left))
      suggestedAction = 'mark_blocked'
    } else if (card.daysOverdue > 0) {
      reason = p.overdueStale(card.daysOverdue, card.daysSinceUpdate)
      suggestedAction = 'move_due_date'
    } else if (left <= 3 && progress < 0.34) {
      reason = p.closeAndEmpty(Math.max(0, left))
      suggestedAction = 'split_into_subtasks'
    } else {
      reason = p.quiet(card.daysSinceUpdate)
      suggestedAction = 'ping_assignee'
    }
    return { cardId: card.id, rank: index + 1, reason, suggestedAction }
  })

  const byPerson = new Map<string, number>()
  for (const card of ranked) {
    if (card.assigneeName)
      byPerson.set(card.assigneeName, (byPerson.get(card.assigneeName) ?? 0) + 1)
  }
  const worst = [...byPerson.entries()].sort((a, b) => b[1] - a[1])[0]
  const load = input.loadPerPerson.find((person) => person.name === worst?.[0])

  return {
    headline:
      worst && worst[1] > 1
        ? p.headlineWithPerson(entries.length, worst[0], worst[1])
        : p.headline(entries.length),
    entries,
    pressurePoints: load ? [{ name: load.name, text: p.pressure(load.name, load.openCount) }] : [],
  }
}

function validateOutput(
  input: BoardRiskDigestInput,
  output: BoardRiskDigestOutput,
): ValidateOutcome<BoardRiskDigestOutput> {
  const byId = new Map(input.cards.map((card) => [card.id, card]))
  const knownPeople = new Set(input.loadPerPerson.map((person) => person.name))
  const seen = new Set<string>()

  const entries = output.entries
    // A digest is only useful if every row is a real card at real risk. An id nobody supplied, a
    // duplicate, or a card the system says is fine are all dropped rather than shown to a head.
    .filter((entry) => {
      const card = byId.get(entry.cardId)
      if (!card || card.riskLevel === 'none' || seen.has(entry.cardId)) return false
      seen.add(entry.cardId)
      return true
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, input.topN)
    .map((entry, index) => ({ ...entry, rank: index + 1 }))

  if (output.entries.length > 0 && entries.length === 0) {
    return {
      ok: false,
      error:
        'Every entry named a card that was not in the input, or one the system reports as not at risk. Rank only the cards you were given.',
    }
  }

  return {
    ok: true,
    output: {
      ...output,
      entries,
      pressurePoints: output.pressurePoints
        .filter((point) => knownPeople.has(point.name))
        .slice(0, 2),
    },
  }
}

export const boardRiskDigestSpec: FeatureSpec<BoardRiskDigestInput, BoardRiskDigestOutput> = {
  feature: 'board_risk_digest',
  inputSchema: boardRiskDigestInputSchema,
  outputSchema: boardRiskDigestOutputSchema,
  toolName: 'emit_board_risk_digest',
  toolDescription:
    'Rank the work items most likely to miss their deadline, one concrete reason and one action each, in a single batched call.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'entries', 'pressurePoints'],
    properties: {
      headline: { type: 'string', minLength: 1, maxLength: 200 },
      entries: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cardId', 'rank', 'reason', 'suggestedAction'],
          properties: {
            cardId: { type: 'string' },
            rank: { type: 'integer', minimum: 1, maximum: 10 },
            reason: { type: 'string', minLength: 1, maxLength: 200 },
            suggestedAction: {
              type: 'string',
              enum: [
                'move_due_date',
                'ping_assignee',
                'split_into_subtasks',
                'reassign',
                'mark_blocked',
              ],
            },
          },
        },
      },
      pressurePoints: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'text'],
          properties: {
            name: { type: 'string' },
            text: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
  },
  defaultMaxTokens: 1792,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

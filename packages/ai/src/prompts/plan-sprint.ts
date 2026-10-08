// F3 plan_sprint (v1.1 AI-AUDIT §3 F3). v1.0 gave the model titles and optional estimates and asked
// it to "reorder sensibly" -- with nothing to reason over, the answer differed from the offline
// sort-by-estimate only in prose, and the `/projects` caller threw the whole plan away and set one
// card to urgent (`project-page-screen.tsx:184`).
//
// v1.1: real inputs (deadlines, priorities, blockers, remaining capacity), ids instead of titles, one
// reason per item, an explicit "this will not fit" set, and a `validateOutput` that REJECTS an
// unfaithful plan rather than rendering a partial one. A plan missing three of someone's tasks,
// shown confidently, is worse than an error they can retry.
import { z } from 'zod'
import {
  ANTI_FABRICATION_CONSTRAINT,
  CITATION_CONSTRAINT,
  TONE_CONSTRAINT,
  composePrompt,
  languageConstraint,
} from '../locale-prompt.js'
import { cardPrioritySchema, idSchema, isoDateTimeSchema, localeSchema } from '../schemas.js'
import { standardUserContent, type FeatureSpec, type ValidateOutcome } from '../feature-spec.js'
import type { Locale } from '../types.js'

export const planItemSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
  estimateMin: z.number().int().min(0).max(10_000).nullable().default(null),
  dueAt: z.string().max(40).nullable().default(null),
  priority: cardPrioritySchema.default('none'),
  /** Project scope only -- who the card sits with. */
  assigneeName: z.string().max(200).nullable().default(null),
  /** Ids of items that must be finished first (card links). */
  blockedByIds: z.array(idSchema).max(20).default([]),
})

export const planSprintInputSchema = z.object({
  locale: localeSchema,
  /** AI-AUDIT D-5: the two callers stop lying to the feature about what they are planning. */
  scope: z.enum(['personal', 'project']),
  periodKind: z.enum(['3h', 'day', 'week', 'custom']),
  now: isoDateTimeSchema,
  periodEndsAt: isoDateTimeSchema,
  /** Working minutes actually left in the period. */
  capacityMin: z.number().int().min(0).max(100_000).nullable(),
  goal: z.string().max(500).nullable().default(null),
  items: z.array(planItemSchema).min(1).max(100),
})
export type PlanSprintInput = z.infer<typeof planSprintInputSchema>

export const planSprintOutputSchema = z.object({
  orderedIds: z.array(idSchema).min(1).max(100),
  focusId: idSchema.nullable(),
  reasons: z.array(z.object({ id: idSchema, reason: z.string().min(1).max(120) })).max(100),
  wontFitIds: z.array(idSchema).max(100),
  overCommittedByMin: z.number().int().min(0),
  summary: z.string().min(1).max(400),
})
export type PlanSprintOutput = z.infer<typeof planSprintOutputSchema>

const FEW_SHOT = `now 2026-09-12T09:00+05:00, periodEndsAt 2026-09-12T18:00+05:00, capacityMin 420, locale uz-Latn
items: t1 "Xatlarga javob berish" est 20 due null prio none | t2 "Choraklik hisobotni yozish" est 240 due 2026-09-13 prio high | t3 "Yigʻilish" est 60 due 2026-09-12 prio none | t4 "Sayt matnini tahrirlash" est 180 due null prio low
out: {"orderedIds":["t3","t2","t1","t4"],"focusId":"t3",
 "reasons":[{"id":"t3","reason":"Bugun belgilangan vaqtda oʻtadi"},
            {"id":"t2","reason":"Ertaga muddati tugaydi, 4 soat kerak"},
            {"id":"t1","reason":"Qisqa, hisobotdan keyin sigʻadi"},
            {"id":"t4","reason":"Muddati yoʻq, ertaga qoldirsa boʻladi"}],
 "wontFitIds":["t4"],"overCommittedByMin":80,
 "summary":"Bugungi kun choraklik hisobotga qaratilgan. Sayt matni bugun sigʻmaydi — ertaga rejalashtiring."}`

function systemPrompt(input: PlanSprintInput): string {
  const totalEstimate = input.items.reduce((sum, item) => sum + (item.estimateMin ?? 0), 0)
  return composePrompt({
    role: 'You plan one working period for a ministry department. You are given the open items, their deadlines and estimates, and how much working time is left. You order them, you say plainly which will not fit, and you give one short reason per decision. You never invent an item and you never move a deadline.',
    inputs: `A JSON object: scope (${input.scope}), periodKind (${input.periodKind}), now, periodEndsAt, capacityMin (${input.capacityMin ?? 'unknown'} working minutes left), goal, items[] each with id, title, estimateMin, dueAt, priority, assigneeName, blockedByIds. The known estimates total ${totalEstimate} minutes; a null estimate is unknown.`,
    instructions: [
      'Order EVERY item, by id, into `orderedIds`. Never drop one, never merge two, never rename, never invent. The set of ids you return must equal the set of ids you were given, exactly.',
      'Respect blockedByIds: a blocker always comes before the item it blocks.',
      'Everything overdue, then everything due before periodEndsAt, comes before anything with no deadline.',
      'Within the same urgency, a short item may come first when finishing it unblocks momentum — but never let a short item push a due item past its deadline.',
      'Only assess capacity when capacityMin and EVERY estimateMin are known. Sum estimates down your order: every item beyond capacityMin goes into wontFitIds, and overCommittedByMin is max(0,total-capacityMin). When capacity or any estimate is null, return wontFitIds [] and overCommittedByMin 0; explicitly say capacity cannot yet be assessed. Never treat a missing estimate as zero or a missing capacity as zero.',
      'focusId is the first item in orderedIds, which is the single item to start right now.',
      'Give exactly one `reason` per item, at most 90 characters, naming the concrete cause ("ertaga muddati tugaydi", "Nodiraning ishini bloklayapti"). Never generic filler like "muhim vazifa".',
      'summary: at most two sentences — what this period is really about, and the one risk.',
    ],
    constraints: [
      languageConstraint(input.locale),
      ANTI_FABRICATION_CONSTRAINT,
      CITATION_CONSTRAINT,
      TONE_CONSTRAINT,
      input.scope === 'project'
        ? 'PEOPLE. You may name a person only if their name appears in items[].assigneeName. Describe workload, never performance.'
        : "PEOPLE. This is one person's private workspace. Never name anybody.",
    ],
    examples: FEW_SHOT,
    toolName: 'emit_sprint_plan',
  })
}

// -- Offline simulator ------------------------------------------------------------------------
// A real scheduler, not a sort: topological order over blockers, then deadline, then priority, then
// estimate; capacity accounted honestly; reasons written in the caller's locale (v1.0's were
// hard-coded English and rendered verbatim in an Uzbek UI).

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }

const REASON: Record<string, Record<Locale, string>> = {
  overdue: {
    'uz-Latn': 'Muddati oʻtgan — birinchi navbatda',
    'uz-Cyrl': 'Муддати ўтган — биринчи навбатда',
    ru: 'Срок уже прошёл — в первую очередь',
    en: 'Already overdue — do this first',
  },
  dueInPeriod: {
    'uz-Latn': 'Muddati shu davrda tugaydi',
    'uz-Cyrl': 'Муддати шу даврда тугайди',
    ru: 'Срок истекает в этом периоде',
    en: 'Its deadline falls inside this period',
  },
  blocker: {
    'uz-Latn': 'Boshqa vazifani bloklayapti',
    'uz-Cyrl': 'Бошқа вазифани блоклаяпти',
    ru: 'Блокирует другую задачу',
    en: 'It is blocking another item',
  },
  priority: {
    'uz-Latn': 'Muhimlik darajasi yuqori',
    'uz-Cyrl': 'Муҳимлик даражаси юқори',
    ru: 'Высокий приоритет',
    en: 'Marked high priority',
  },
  short: {
    'uz-Latn': 'Qisqa ish — tezda yopiladi',
    'uz-Cyrl': 'Қисқа иш — тезда ёпилади',
    ru: 'Короткая задача — закрывается быстро',
    en: 'Short — closes quickly',
  },
  later: {
    'uz-Latn': 'Muddati yoʻq — keyinroqqa qoldirsa boʻladi',
    'uz-Cyrl': 'Муддати йўқ — кейинроққа қолдирса бўлади',
    ru: 'Без срока — можно отложить',
    en: 'No deadline — it can wait',
  },
}

const SUMMARY_FITS: Record<Locale, string> = {
  'uz-Latn': 'Rejadagi hamma narsa shu davrga sigʻadi.',
  'uz-Cyrl': 'Режадаги ҳамма нарса шу даврга сиғади.',
  ru: 'Всё запланированное помещается в этот период.',
  en: 'Everything planned fits inside this period.',
}

const CAPACITY_UNKNOWN: Record<Locale, string> = {
  'uz-Latn': 'Ish hajmi yoki mavjud vaqt koʻrsatilmagan — hammasi sigʻishini baholab boʻlmaydi.',
  'uz-Cyrl': 'Иш ҳажми ёки мавжуд вақт кўрсатилмаган — ҳаммаси сиғишини баҳолаб бўлмайди.',
  ru: 'Объём работы или доступное время не указаны — оценить, всё ли поместится, нельзя.',
  en: 'Estimates or available working time are missing — capacity cannot yet be assessed.',
}

const SUMMARY_OVER: Record<Locale, (over: number, count: number) => string> = {
  'uz-Latn': (over, count) =>
    `Bu davrga ${count} ta vazifa sigʻmaydi — ${over} daqiqa ortiqcha. Ularni keyingi davrga koʻchiring.`,
  'uz-Cyrl': (over, count) =>
    `Бу даврга ${count} та вазифа сиғмайди — ${over} дақиқа ортиқча. Уларни кейинги даврга кўчиринг.`,
  ru: (over, count) =>
    `${count} задач(и) не помещаются в период — перебор ${over} минут. Перенесите их на следующий период.`,
  en: (over, count) =>
    `${count} item(s) do not fit this period — ${over} minutes over. Move them to the next one.`,
}

function simulate(input: PlanSprintInput): PlanSprintOutput {
  const byId = new Map(input.items.map((item) => [item.id, item]))
  const nowMs = Date.parse(input.now)
  const endMs = Date.parse(input.periodEndsAt)

  const score = (item: PlanSprintInput['items'][number]): number => {
    const dueMs = item.dueAt ? Date.parse(item.dueAt) : Number.POSITIVE_INFINITY
    const overdue = Number.isFinite(dueMs) && dueMs < nowMs ? 0 : 1
    const dueInPeriod = Number.isFinite(dueMs) && dueMs <= endMs ? 0 : 1
    return (
      overdue * 1_000_000 +
      dueInPeriod * 100_000 +
      (PRIORITY_RANK[item.priority] ?? 4) * 1_000 +
      Math.min(999, Math.round((item.estimateMin ?? 60) / 15))
    )
  }

  // Topological pass: an item whose blockers are all already placed becomes eligible; among the
  // eligible, the lowest score wins. A blocker cycle degrades to plain score order rather than
  // hanging, which is the right failure for data a person typed.
  const placed: string[] = []
  const remaining = [...input.items]
  while (remaining.length > 0) {
    const eligible = remaining.filter((item) =>
      item.blockedByIds.every((id) => !byId.has(id) || placed.includes(id)),
    )
    const pool = eligible.length > 0 ? eligible : remaining
    pool.sort((a, b) => score(a) - score(b))
    const next = pool[0]!
    placed.push(next.id)
    remaining.splice(
      remaining.findIndex((item) => item.id === next.id),
      1,
    )
  }

  const blockerIds = new Set(input.items.flatMap((item) => item.blockedByIds))
  const reasons = placed.map((id) => {
    const item = byId.get(id)!
    const dueMs = item.dueAt ? Date.parse(item.dueAt) : Number.NaN
    let key: string
    if (Number.isFinite(dueMs) && dueMs < nowMs) key = 'overdue'
    else if (Number.isFinite(dueMs) && dueMs <= endMs) key = 'dueInPeriod'
    else if (blockerIds.has(id)) key = 'blocker'
    else if (item.priority === 'urgent' || item.priority === 'high') key = 'priority'
    else if ((item.estimateMin ?? 60) <= 30) key = 'short'
    else key = 'later'
    return { id, reason: REASON[key]![input.locale] }
  })

  const canAssessCapacity =
    input.capacityMin !== null && input.items.every((item) => item.estimateMin !== null)
  let running = 0
  const wontFitIds: string[] = []
  for (const id of placed) {
    const estimate = byId.get(id)?.estimateMin ?? 0
    if (canAssessCapacity && running + estimate > input.capacityMin!) wontFitIds.push(id)
    running += estimate
  }
  const overCommittedByMin = canAssessCapacity ? Math.max(0, running - input.capacityMin!) : 0

  return {
    orderedIds: placed,
    focusId: placed[0] ?? null,
    reasons,
    wontFitIds,
    overCommittedByMin,
    summary: !canAssessCapacity
      ? CAPACITY_UNKNOWN[input.locale]
      : overCommittedByMin > 0
        ? SUMMARY_OVER[input.locale](overCommittedByMin, wontFitIds.length)
        : SUMMARY_FITS[input.locale],
  }
}

/**
 * The strict one. AI-AUDIT §3 F3: "Fail the run rather than render a partial plan — this is a case
 * where a schema-valid but unfaithful answer is worse than an error."
 */
function validateOutput(
  input: PlanSprintInput,
  output: PlanSprintOutput,
): ValidateOutcome<PlanSprintOutput> {
  const expected = new Set(input.items.map((item) => item.id))
  const got = new Set(output.orderedIds)
  const missing = [...expected].filter((id) => !got.has(id))
  const extra = [...got].filter((id) => !expected.has(id))
  if (output.orderedIds.length !== got.size) {
    return {
      ok: false,
      error: 'orderedIds contains the same id more than once. Each item appears exactly once.',
    }
  }
  if (missing.length > 0 || extra.length > 0) {
    return {
      ok: false,
      error: `orderedIds must be exactly the ids you were given. Missing: [${missing.join(', ')}]. Not in the input: [${extra.join(', ')}].`,
    }
  }
  if (output.focusId !== null && !expected.has(output.focusId)) {
    return {
      ok: false,
      error: `focusId "${output.focusId}" is not one of the item ids you were given.`,
    }
  }

  // Blocker order is a hard rule, not a preference: a plan that tells someone to do the blocked
  // item first is wrong in a way the reader cannot see.
  const position = new Map(output.orderedIds.map((id, index) => [id, index]))
  for (const item of input.items) {
    for (const blockerId of item.blockedByIds) {
      if (!expected.has(blockerId)) continue
      if ((position.get(blockerId) ?? 0) > (position.get(item.id) ?? 0)) {
        return {
          ok: false,
          error: `"${blockerId}" blocks "${item.id}", so it must come before it in orderedIds.`,
        }
      }
    }
  }

  // Repairable: stray reasons and stray wontFit ids are dropped; a missing reason is filled from the
  // item's own deadline rather than failing an otherwise faithful plan.
  const reasons = [
    ...new Map(
      output.reasons.filter((entry) => expected.has(entry.id)).map((entry) => [entry.id, entry]),
    ).values(),
  ]
  const covered = new Set(reasons.map((entry) => entry.id))
  const simulated = simulate(input)
  const simulatedReason = new Map(simulated.reasons.map((entry) => [entry.id, entry.reason]))
  for (const id of output.orderedIds) {
    if (!covered.has(id)) reasons.push({ id, reason: simulatedReason.get(id) ?? '—' })
  }

  // Arithmetic is measured by the server, not delegated to prose generation.
  const canAssessCapacity =
    input.capacityMin !== null && input.items.every((item) => item.estimateMin !== null)
  let running = 0
  const wontFitIds: string[] = []
  for (const id of output.orderedIds) {
    running += input.items.find((item) => item.id === id)?.estimateMin ?? 0
    if (canAssessCapacity && running > input.capacityMin!) wontFitIds.push(id)
  }
  return {
    ok: true,
    output: {
      ...output,
      focusId: output.orderedIds[0] ?? null,
      reasons,
      wontFitIds,
      overCommittedByMin: canAssessCapacity ? Math.max(0, running - input.capacityMin!) : 0,
      summary: canAssessCapacity ? output.summary : CAPACITY_UNKNOWN[input.locale],
    },
  }
}

export const planSprintSpec: FeatureSpec<PlanSprintInput, PlanSprintOutput> = {
  feature: 'plan_sprint',
  inputSchema: planSprintInputSchema,
  outputSchema: planSprintOutputSchema,
  toolName: 'emit_sprint_plan',
  toolDescription:
    'Emit the complete ordered plan for one working period: every item id in working order, the one to start with, a reason per item, and which items do not fit the remaining capacity.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['orderedIds', 'focusId', 'reasons', 'wontFitIds', 'overCommittedByMin', 'summary'],
    properties: {
      orderedIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string' } },
      focusId: { type: ['string', 'null'] },
      reasons: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'reason'],
          properties: {
            id: { type: 'string' },
            reason: { type: 'string', maxLength: 120 },
          },
        },
      },
      wontFitIds: { type: 'array', maxItems: 100, items: { type: 'string' } },
      overCommittedByMin: { type: 'integer', minimum: 0 },
      summary: { type: 'string', minLength: 1, maxLength: 400 },
    },
  },
  // GLM-5.3 needs room to calculate capacity and still emit the structured plan.
  defaultMaxTokens: 3072,
  temperature: 0,
  systemPrompt,
  buildUserContent: standardUserContent,
  validateOutput,
  simulate,
}

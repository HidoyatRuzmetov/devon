// The golden set (TECH-SPEC §8/§12: "promptfoo golden sets in CI"; v1.1 AI-AUDIT §6).
//
// Every case runs twice in practice: against the offline simulator on any machine with no
// `AI_API_KEY` (asserting schema validity and the mechanical guard rails — ids ⊆ input, names ⊆
// input, orthography, faithfulness), and against real GLM when a key is present (which adds the
// semantic assertions for free, because the assertions below are written to hold for both).
//
// Three assertion classes, all mechanical, none needing a human:
//   * faithfulness — every id/name/date in the output appeared in the input;
//   * language     — the right locale, correct oʻ/gʻ, glossary terms present;
//   * behaviour    — the feature-specific fact (a weekday resolves to the right date, capacity
//                    overflow is flagged, `insufficientInput` fires on a vague title).
//
// Plus, per AI-AUDIT §6.3, a determinism case per extraction feature: the same input three times at
// `temperature: 0` must produce byte-identical output. That is the direct test for "feels random".
import { hasAsciiApostrophe } from '../src/uz.js'
import type { AiFeature } from '../src/types.js'

export type EvalCase = {
  id: string
  feature: AiFeature
  input: Record<string, unknown>
  /** A cheap, mechanical check beyond "the schema parsed". Returns an error string, or null. */
  check?(output: unknown, input: Record<string, unknown>): string | null
  /** Run three times and require byte-identical output (AI-AUDIT §6.3). */
  determinism?: boolean
}

// -- Shared assertion helpers ------------------------------------------------------------------

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) strings(item, out)
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) strings(child, out)
  }
  return out
}

/** Every uz-Latn string in the answer uses U+02BB / U+02BC, never an ASCII apostrophe. */
function orthography(output: unknown): string | null {
  for (const value of strings(output)) {
    if (hasAsciiApostrophe(value)) return `ASCII apostrophe in uz-Latn output: ${value}`
  }
  return null
}

/** Every string leaf is Cyrillic-free (for a Latin locale) or Latin-free (for a Cyrillic one). */
function scriptOf(
  output: unknown,
  expect: 'cyrillic' | 'latin',
  skip: readonly string[] = [],
): string | null {
  for (const value of strings(output)) {
    if (value.length < 8) continue
    if (skip.some((needle) => value.includes(needle))) continue
    const hasCyrillic = /[Ѐ-ӿ]/.test(value)
    const hasLatin = /[A-Za-z]{4,}/.test(value)
    if (expect === 'cyrillic' && !hasCyrillic && hasLatin) return `expected Cyrillic, got: ${value}`
    if (expect === 'latin' && hasCyrillic) return `expected Latin, got: ${value}`
  }
  return null
}

function all(...checks: Array<string | null>): string | null {
  return checks.find((problem) => problem !== null) ?? null
}

const MEMBERS = [
  { userId: 'u1', fullName: 'Nodira Karimova', givenName: 'Nodira', handle: 'nodira' },
  { userId: 'u2', fullName: 'Anvar Aliyev', givenName: 'Anvar', handle: 'anvar' },
]
const TWO_KARIMOVAS = [
  { userId: 'u1', fullName: 'Nodira Karimova', givenName: 'Nodira', handle: 'nodira' },
  { userId: 'u3', fullName: 'Dilnoza Karimova', givenName: 'Dilnoza', handle: 'dilnoza' },
]
const LABELS = [
  { id: 'l1', name: 'EGDI' },
  { id: 'l2', name: 'hisobot' },
]
const TODAY = '2026-09-12' // a Saturday

type QuickAdd = {
  title: string
  assigneeUserId: string | null
  dueDate: string | null
  priority: string
  labelIds: string[]
  ambiguous: string[]
  confidence: { assignee: string; dueDate: string; priority: string }
}

export const EVAL_CASES: EvalCase[] = [
  // ---------------------------------------------------------------- F1 quick_add_parse (10 cases)
  {
    id: 'quick-add.uz-latn.weekday-suffix',
    feature: 'quick_add_parse',
    determinism: true,
    input: {
      locale: 'uz-Latn',
      text: 'Nodira: EGDI paketi jumagacha',
      today: TODAY,
      members: MEMBERS,
      labels: LABELS,
    },
    check: (out) => {
      const o = out as QuickAdd
      if (o.dueDate !== '2026-09-18')
        return `expected dueDate 2026-09-18 (next Friday), got ${o.dueDate}`
      return orthography(out)
    },
  },
  {
    id: 'quick-add.uz-latn.dative-name',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: 'Nodiraga hisobotni tayyorlashni topshir',
      today: TODAY,
      members: MEMBERS,
      labels: LABELS,
    },
    check: (out) => {
      const o = out as QuickAdd
      return o.assigneeUserId === 'u1'
        ? null
        : `expected u1 (Nodira), got ${String(o.assigneeUserId)}`
    },
  },
  {
    id: 'quick-add.uz-latn.urgency',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: 'Anvarga hisobotni indinga tayyorlashni topshir, shoshilinch',
      today: TODAY,
      members: MEMBERS,
      labels: LABELS,
    },
    check: (out) => {
      const o = out as QuickAdd
      if (o.priority !== 'urgent') return `expected priority urgent, got ${o.priority}`
      if (o.dueDate !== '2026-09-14')
        return `expected dueDate 2026-09-14 (indinga), got ${o.dueDate}`
      return null
    },
  },
  {
    id: 'quick-add.uz-cyrl.basic',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Cyrl',
      text: 'Нодирага ҳисоботни эртага топшир',
      today: TODAY,
      members: MEMBERS,
    },
    check: (out) => {
      const o = out as QuickAdd
      if (o.dueDate !== '2026-09-13') return `expected tomorrow 2026-09-13, got ${o.dueDate}`
      return scriptOf({ title: o.title }, 'cyrillic')
    },
  },
  {
    id: 'quick-add.ru.dative',
    feature: 'quick_add_parse',
    input: {
      locale: 'ru',
      text: 'Поручить Анвару подготовить отчёт к пятнице',
      today: TODAY,
      members: MEMBERS,
      labels: LABELS,
    },
    check: (out) => {
      const o = out as QuickAdd
      return o.dueDate === '2026-09-18' || o.dueDate === null
        ? null
        : `expected next Friday or null, got ${o.dueDate}`
    },
  },
  {
    id: 'quick-add.en.no-date',
    feature: 'quick_add_parse',
    input: { locale: 'en', text: 'Prepare the quarterly report', today: TODAY, members: MEMBERS },
    check: (out) => {
      const o = out as QuickAdd
      return o.dueDate === null
        ? null
        : `fabricated a date (${o.dueDate}) from a sentence with none`
    },
  },
  {
    id: 'quick-add.any.no-invented-label',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: 'Byudjet jadvalini tayyorlash, moliya boʻyicha',
      today: TODAY,
      members: MEMBERS,
      labels: LABELS,
    },
    check: (out, input) => {
      const allowed = new Set((input['labels'] as { id: string }[]).map((label) => label.id))
      const bad = (out as QuickAdd).labelIds.filter((id) => !allowed.has(id))
      return bad.length === 0 ? null : `invented label ids: ${bad.join(', ')}`
    },
  },
  {
    id: 'quick-add.any.title-excludes-name',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: 'Nodiraga hisobotni tayyorlashni topshir',
      today: TODAY,
      members: MEMBERS,
    },
    check: (out) =>
      /nodira/i.test((out as QuickAdd).title) ? 'title still contains the assignee name' : null,
  },
  {
    id: 'quick-add.uz-latn.ambiguous',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: 'Karimovaga yuborish',
      today: TODAY,
      members: TWO_KARIMOVAS,
    },
    check: (out) => {
      const o = out as QuickAdd
      if (o.assigneeUserId !== null) return 'two members matched but one was chosen anyway'
      return o.ambiguous.length === 2
        ? null
        : `expected 2 ambiguous names, got ${o.ambiguous.length}`
    },
  },
  {
    id: 'quick-add.uz-latn.orthography',
    feature: 'quick_add_parse',
    input: {
      locale: 'uz-Latn',
      text: "Bo'lim uchun o'zgarishlarni tayyorlash",
      today: TODAY,
      members: MEMBERS,
    },
    check: (out) => orthography(out),
  },

  // ------------------------------------------------------------- F2 subtask_breakdown (6 cases)
  {
    id: 'subtasks.uz-latn.egdi',
    feature: 'subtask_breakdown',
    input: {
      locale: 'uz-Latn',
      cardTitle: 'EGDI paketini tayyorlash',
      labels: ['EGDI'],
      dueInDays: 5,
      targetCount: 6,
    },
    check: (out) => {
      const o = out as { subtasks: { text: string; estimateMin: number }[] }
      if (o.subtasks.length < 4 || o.subtasks.length > 8) {
        return `expected 4-8 steps, got ${o.subtasks.length}`
      }
      if (
        o.subtasks.some((step) => step.text.trim().toLowerCase() === 'egdi paketini tayyorlash')
      ) {
        return 'a step restates the card title'
      }
      return orthography(out)
    },
  },
  {
    id: 'subtasks.uz-latn.no-duplicate',
    feature: 'subtask_breakdown',
    input: {
      locale: 'uz-Latn',
      cardTitle: 'EGDI paketini tayyorlash',
      existingSubtasks: ['Boʻlimlardan kerakli maʼlumotlarni yigʻish'],
      labels: ['EGDI'],
    },
    check: (out, input) => {
      const existing = new Set(
        (input['existingSubtasks'] as string[]).map((s) => s.trim().toLowerCase()),
      )
      const o = out as { subtasks: { text: string }[] }
      const clash = o.subtasks.find((step) => existing.has(step.text.trim().toLowerCase()))
      return clash ? `repeated an existing step: ${clash.text}` : null
    },
  },
  {
    id: 'subtasks.uz-latn.vague',
    feature: 'subtask_breakdown',
    input: { locale: 'uz-Latn', cardTitle: 'Hisobot', cardDescription: null },
    check: (out) => {
      const o = out as { subtasks: unknown[]; insufficientInput: boolean }
      if (!o.insufficientInput) return 'a two-word title with no description was broken down anyway'
      return o.subtasks.length === 1
        ? null
        : `expected exactly 1 clarifying step, got ${o.subtasks.length}`
    },
  },
  {
    id: 'subtasks.ru.report',
    feature: 'subtask_breakdown',
    input: {
      locale: 'ru',
      cardTitle: 'Подготовить квартальный отчёт',
      cardDescription: 'Собрать цифры. Написать текст. Получить утверждение.',
    },
    check: (out) => scriptOf(out, 'cyrillic'),
  },
  {
    id: 'subtasks.en.estimates-bucketed',
    feature: 'subtask_breakdown',
    input: { locale: 'en', cardTitle: 'Launch the new intranet page', targetCount: 5 },
    check: (out) => {
      const allowed = new Set([15, 30, 60, 120, 240])
      const o = out as { subtasks: { estimateMin: number }[] }
      const bad = o.subtasks.find((step) => !allowed.has(step.estimateMin))
      return bad ? `estimateMin ${bad.estimateMin} is not one of 15/30/60/120/240` : null
    },
  },
  {
    id: 'subtasks.any.no-person',
    feature: 'subtask_breakdown',
    input: {
      locale: 'uz-Latn',
      cardTitle: 'Choraklik hisobotni tayyorlash va vazirlikka yuborish',
      labels: ['hisobot'],
    },
    check: (out) => {
      const named = strings(out).find((value) => /Nodira|Anvar|Dilnoza/.test(value))
      return named ? `named a person nobody mentioned: ${named}` : null
    },
  },

  // ------------------------------------------------------------------ F3 plan_sprint (8 cases)
  ...(() => {
    const base = {
      locale: 'uz-Latn',
      scope: 'personal',
      periodKind: 'day',
      now: '2026-09-12T09:00:00+05:00',
      periodEndsAt: '2026-09-12T18:00:00+05:00',
    }
    const items = [
      { id: 't1', title: 'Xatlarga javob berish', estimateMin: 20 },
      {
        id: 't2',
        title: 'Choraklik hisobotni yozish',
        estimateMin: 240,
        dueAt: '2026-09-13',
        priority: 'high',
      },
      { id: 't3', title: 'Yigʻilish', estimateMin: 60, dueAt: '2026-09-12' },
      { id: 't4', title: 'Sayt matnini tahrirlash', estimateMin: 180, priority: 'low' },
    ]
    type Plan = {
      orderedIds: string[]
      focusId: string | null
      reasons: { id: string; reason: string }[]
      wontFitIds: string[]
      overCommittedByMin: number
    }
    return [
      {
        id: 'plan.personal.day.faithful',
        feature: 'plan_sprint' as const,
        determinism: true,
        input: { ...base, capacityMin: 420, items },
        check: (out: unknown, input: Record<string, unknown>) => {
          const expected = new Set((input['items'] as { id: string }[]).map((item) => item.id))
          const got = (out as Plan).orderedIds
          if (got.length !== expected.size)
            return `expected ${expected.size} ids, got ${got.length}`
          const missing = [...expected].filter((id) => !got.includes(id))
          return missing.length === 0 ? null : `dropped: ${missing.join(', ')}`
        },
      },
      {
        id: 'plan.personal.day.due-first',
        feature: 'plan_sprint' as const,
        input: { ...base, capacityMin: 420, items },
        check: (out: unknown) => {
          const order = (out as Plan).orderedIds
          return order.indexOf('t2') < order.indexOf('t4')
            ? null
            : 'an item due tomorrow was planned after one with no deadline'
        },
      },
      {
        id: 'plan.personal.blocked',
        feature: 'plan_sprint' as const,
        input: {
          ...base,
          capacityMin: 420,
          items: [
            { id: 'b1', title: 'Vazirlik javobini kutish', estimateMin: 30 },
            { id: 'b2', title: 'Paketni yuborish', estimateMin: 30, blockedByIds: ['b1'] },
          ],
        },
        check: (out: unknown) => {
          const order = (out as Plan).orderedIds
          return order.indexOf('b1') < order.indexOf('b2')
            ? null
            : 'a blocker was planned after what it blocks'
        },
      },
      {
        id: 'plan.personal.capacity',
        feature: 'plan_sprint' as const,
        input: { ...base, capacityMin: 120, items },
        check: (out: unknown) => {
          const o = out as Plan
          if (o.wontFitIds.length === 0)
            return '500 minutes of work in a 120-minute period, and nothing was flagged'
          return o.overCommittedByMin > 0
            ? null
            : 'wontFitIds is non-empty but overCommittedByMin is 0'
        },
      },
      {
        id: 'plan.personal.fits',
        feature: 'plan_sprint' as const,
        input: {
          ...base,
          capacityMin: 480,
          items: [{ id: 's1', title: 'Xatlarga javob berish', estimateMin: 20 }],
        },
        check: (out: unknown) => {
          const o = out as Plan
          if (o.wontFitIds.length !== 0) return 'flagged an item that comfortably fits'
          return o.overCommittedByMin === 0
            ? null
            : 'overCommittedByMin is non-zero for a plan that fits'
        },
      },
      {
        id: 'plan.project.assignee-grounded',
        feature: 'plan_sprint' as const,
        input: {
          ...base,
          scope: 'project',
          capacityMin: 480,
          goal: 'EGDI paketi',
          items: [
            {
              id: 'p1',
              title: 'Maʼlumot yigʻish',
              estimateMin: 120,
              assigneeName: 'Nodira Karimova',
            },
            { id: 'p2', title: 'Loyihani yozish', estimateMin: 240, assigneeName: 'Anvar Aliyev' },
          ],
        },
        check: (out: unknown) => {
          const named = strings(out).find((value) => /Dilnoza|Sardor|Jasur/.test(value))
          return named ? `named a person absent from the input: ${named}` : null
        },
      },
      {
        id: 'plan.uz-latn.reasons-localised',
        feature: 'plan_sprint' as const,
        input: { ...base, capacityMin: 420, items },
        check: (out: unknown) => all(orthography(out), scriptOf(out, 'latin')),
      },
      {
        id: 'plan.any.one-reason-per-item',
        feature: 'plan_sprint' as const,
        input: { ...base, capacityMin: 420, items },
        check: (out: unknown) => {
          const o = out as Plan
          return o.reasons.length === o.orderedIds.length
            ? null
            : `${o.orderedIds.length} items but ${o.reasons.length} reasons`
        },
      },
    ]
  })(),

  // ---------------------------------------------------------------- F4 deadline_risk (7 cases)
  ...(() => {
    type Risk = {
      riskLevel: string
      explanation: string
      actionKind: string
      actionPayload: { suggestedDueDate: string | null }
    }
    const card = {
      id: 'c1',
      title: 'Choraklik hisobot',
      dueDate: '2026-09-01',
      today: '2026-09-08',
      checklistTotal: 4,
      checklistDone: 1,
      daysSinceUpdate: 10,
      assigneeName: 'Nodira Karimova',
    }
    return [
      {
        id: 'risk.echo-level.overdue',
        feature: 'deadline_risk' as const,
        determinism: true,
        input: { locale: 'uz-Latn', card: { ...card, riskLevel: 'overdue' } },
        check: (out: unknown) =>
          (out as Risk).riskLevel === 'overdue' ? null : 'changed the level the system decided',
      },
      {
        id: 'risk.echo-level.at-risk',
        feature: 'deadline_risk' as const,
        input: {
          locale: 'uz-Latn',
          card: { ...card, riskLevel: 'at_risk', dueDate: '2026-09-11', daysSinceUpdate: 2 },
        },
        check: (out: unknown) =>
          (out as Risk).riskLevel === 'at_risk' ? null : 'changed the level the system decided',
      },
      {
        id: 'risk.none.no-action',
        feature: 'deadline_risk' as const,
        input: {
          locale: 'uz-Latn',
          card: {
            ...card,
            riskLevel: 'none',
            checklistDone: 4,
            daysSinceUpdate: 1,
            dueDate: '2026-10-01',
          },
        },
        check: (out: unknown) => {
          const o = out as Risk
          if (o.riskLevel !== 'none') return 'changed the level'
          return o.actionKind === 'none' ? null : `proposed "${o.actionKind}" for a healthy item`
        },
      },
      {
        id: 'risk.overdue.numbers',
        feature: 'deadline_risk' as const,
        input: { locale: 'uz-Latn', card: { ...card, riskLevel: 'overdue' } },
        check: (out: unknown) => {
          const text = (out as Risk).explanation
          return /\b7\b/.test(text) || /\b10\b/.test(text)
            ? null
            : 'the explanation carries neither the real day count nor the real stall'
        },
      },
      {
        id: 'risk.blocked.actionKind',
        feature: 'deadline_risk' as const,
        input: {
          locale: 'uz-Latn',
          card: { ...card, riskLevel: 'at_risk', blockedByTitles: ['Vazirlik javobini kutish'] },
        },
        check: (out: unknown) =>
          (out as Risk).actionKind === 'mark_blocked'
            ? null
            : `a blocked item got "${(out as Risk).actionKind}" instead of mark_blocked`,
      },
      {
        id: 'risk.move-date.future',
        feature: 'deadline_risk' as const,
        input: { locale: 'uz-Latn', card: { ...card, riskLevel: 'overdue' } },
        check: (out: unknown, input: Record<string, unknown>) => {
          const o = out as Risk
          if (o.actionKind !== 'move_due_date') return null
          const today = (input['card'] as { today: string }).today
          const suggested = o.actionPayload.suggestedDueDate
          return suggested !== null && suggested > today
            ? null
            : `suggested ${String(suggested)} which is not after ${today}`
        },
      },
      {
        id: 'risk.uz-latn.orthography',
        feature: 'deadline_risk' as const,
        input: { locale: 'uz-Latn', card: { ...card, riskLevel: 'overdue' } },
        check: (out: unknown) => all(orthography(out), scriptOf(out, 'latin')),
      },
    ]
  })(),

  // --------------------------------------------------------------------- catch_up (8 cases)
  ...(() => {
    type CatchUp = {
      headline: string
      wins: { citedIds: string[] }
      risks: { cardId: string }[]
      overloaded: { name: string; openCount: number }[]
      lookingAhead: { citedIds: string[] }
      items: { refId: string; needsAction: boolean }[]
      moreCount: number
      needsActionCount: number
    }
    const dept = {
      locale: 'uz-Latn',
      scope: 'department',
      window: 'week',
      subjectName: 'Raqamli xizmatlar boshqarmasi',
      viewerName: 'Anvar Aliyev',
      period: { start: '2026-09-05', end: '2026-09-12' },
      counts: { done: 14, doneLastPeriod: 11, created: 9, overdue: 2 },
      done: [
        { id: 'c3', title: 'Choraklik hisobot' },
        { id: 'c7', title: 'Sayt yangilanishi' },
      ],
      overdue: [
        {
          id: 'c9',
          title: 'EGDI paketi',
          assigneeName: 'Nodira',
          daysOverdue: 5,
          daysSinceUpdate: 9,
        },
        {
          id: 'c11',
          title: 'Byudjet jadvali',
          assigneeName: 'Anvar',
          daysOverdue: 1,
          daysSinceUpdate: 2,
        },
      ],
      dueThisWeek: [
        { id: 'c21', title: 'Sayt matni', assigneeName: 'Anvar', dueDate: '2026-09-16' },
      ],
      loadPerPerson: [
        { name: 'Anvar', openCount: 9, overdueCount: 2 },
        { name: 'Nodira', openCount: 4, overdueCount: 1 },
        { name: 'Dilnoza', openCount: 3, overdueCount: 0 },
      ],
    }
    const knownIds = (input: Record<string, unknown>): Set<string> => {
      const set = new Set<string>()
      for (const key of ['done', 'overdue', 'dueThisWeek', 'assignedToMe'] as const) {
        for (const item of (input[key] as { id: string }[] | undefined) ?? []) set.add(item.id)
      }
      for (const key of ['mentions', 'comments'] as const) {
        for (const item of (input[key] as { id: string; cardId: string }[] | undefined) ?? []) {
          set.add(item.id)
          set.add(item.cardId)
        }
      }
      for (const item of (input['eventsAhead'] as { id: string }[] | undefined) ?? [])
        set.add(item.id)
      return set
    }
    return [
      {
        id: 'catchup.dept.cites-only-given',
        feature: 'catch_up' as const,
        input: dept,
        check: (out: unknown, input: Record<string, unknown>) => {
          const known = knownIds(input)
          const o = out as CatchUp
          const cited = [
            ...o.wins.citedIds,
            ...o.lookingAhead.citedIds,
            ...o.risks.map((r) => r.cardId),
          ]
          const bad = cited.filter((id) => !known.has(id))
          return bad.length === 0 ? null : `cited ids nobody supplied: ${bad.join(', ')}`
        },
      },
      {
        id: 'catchup.dept.trend',
        feature: 'catch_up' as const,
        input: dept,
        check: (out: unknown) => {
          const headline = (out as CatchUp).headline
          return /14/.test(headline)
            ? null
            : `headline does not carry the closed count: ${headline}`
        },
      },
      {
        id: 'catchup.dept.overloaded-grounded',
        feature: 'catch_up' as const,
        input: dept,
        check: (out: unknown, input: Record<string, unknown>) => {
          const load = new Map(
            (input['loadPerPerson'] as { name: string; openCount: number }[]).map((p) => [
              p.name,
              p.openCount,
            ]),
          )
          for (const person of (out as CatchUp).overloaded) {
            if (!load.has(person.name)) return `named somebody not in loadPerPerson: ${person.name}`
            if (load.get(person.name) !== person.openCount) {
              return `restated ${person.name}'s open count as ${person.openCount}, not ${load.get(person.name)}`
            }
          }
          return null
        },
      },
      {
        id: 'catchup.dept.risk-order',
        feature: 'catch_up' as const,
        input: dept,
        check: (out: unknown) => {
          const risks = (out as CatchUp).risks
          if (risks.length < 2) return null
          return risks[0]!.cardId === 'c9'
            ? null
            : 'the 5-day-overdue item was not ranked above the 1-day one'
        },
      },
      {
        id: 'catchup.dept.empty',
        feature: 'catch_up' as const,
        input: {
          ...dept,
          counts: { done: 0, doneLastPeriod: 0, created: 0, overdue: 0 },
          done: [],
          overdue: [],
          dueThisWeek: [],
          loadPerPerson: [],
        },
        check: (out: unknown) => {
          const o = out as CatchUp
          if (o.risks.length > 0) return 'invented risks for an empty period'
          return o.overloaded.length === 0
            ? null
            : 'invented an overloaded person for an empty period'
        },
      },
      {
        id: 'catchup.person.no-overloaded',
        feature: 'catch_up' as const,
        input: {
          ...dept,
          scope: 'person',
          window: 'since_last_visit',
          subjectName: 'Anvar Aliyev',
          assignedToMe: [
            { id: 'c2', title: 'EGDI jadvali', assigneeName: 'Nodira', dueDate: '2026-09-13' },
          ],
          mentions: [
            {
              id: 'k7',
              cardId: 'c4',
              cardTitle: 'Byudjet',
              author: 'Dilnoza',
              excerpt: 'Anvar, raqamlarni tasdiqlaysizmi?',
              mentionsMe: true,
            },
          ],
        },
        check: (out: unknown) =>
          (out as CatchUp).overloaded.length === 0
            ? null
            : 'a personal catch-up named an overloaded person',
      },
      {
        id: 'catchup.person.needs-action-count',
        feature: 'catch_up' as const,
        input: {
          ...dept,
          scope: 'person',
          window: 'since_last_visit',
          assignedToMe: [
            { id: 'c2', title: 'EGDI jadvali', assigneeName: 'Nodira', dueDate: '2026-09-13' },
          ],
        },
        check: (out: unknown) => {
          const o = out as CatchUp
          const actual = o.items.filter((item) => item.needsAction).length
          return o.needsActionCount === actual
            ? null
            : `needsActionCount says ${o.needsActionCount} but ${actual} items are flagged`
        },
      },
      {
        id: 'catchup.ru.locale',
        feature: 'catch_up' as const,
        input: { ...dept, locale: 'ru' },
        check: (out: unknown) => scriptOf(out, 'cyrillic', ['EGDI']),
      },
    ]
  })(),

  // ------------------------------------------------------------------- F6 draft_event (8 cases)
  ...(() => {
    type Draft = {
      title: string
      description: string
      dateOptions: { date: string }[]
      checklist: string[]
      carpool: { needed: boolean }
      estimatedAttendees: number
    }
    return [
      {
        id: 'event.uz-latn.chorvoq',
        feature: 'draft_event' as const,
        input: {
          locale: 'uz-Latn',
          idea: 'Chorvoqda kuz sayli',
          category: 'team_building',
          today: TODAY,
          departmentSize: 18,
        },
        check: (out: unknown) => {
          const o = out as Draft
          const notSaturday = o.dateOptions.find(
            (option) => new Date(`${option.date}T00:00:00Z`).getUTCDay() !== 6,
          )
          if (notSaturday)
            return `a team outing was proposed for ${notSaturday.date}, not a Saturday`
          return o.carpool.needed ? null : 'Chorvoq is outside Tashkent but carpool.needed is false'
        },
      },
      {
        id: 'event.uz-latn.training',
        feature: 'draft_event' as const,
        input: {
          locale: 'uz-Latn',
          idea: 'Excel boʻyicha ichki oʻquv',
          category: 'training',
          today: TODAY,
          departmentSize: 12,
        },
        check: (out: unknown) => {
          const bad = (out as Draft).dateOptions.find((option) => {
            const day = new Date(`${option.date}T00:00:00Z`).getUTCDay()
            return day === 0 || day === 6
          })
          return bad ? `training was proposed for a weekend (${bad.date})` : null
        },
      },
      {
        id: 'event.any.real-dates',
        feature: 'draft_event' as const,
        input: { locale: 'uz-Latn', idea: 'Chorvoqda kuz sayli', today: TODAY, departmentSize: 18 },
        check: (out: unknown, input: Record<string, unknown>) => {
          const today = input['today'] as string
          const past = (out as Draft).dateOptions.find((option) => option.date <= today)
          return past ? `proposed a date in the past: ${past.date}` : null
        },
      },
      {
        id: 'event.any.no-repeat',
        feature: 'draft_event' as const,
        input: {
          locale: 'uz-Latn',
          idea: 'Chorvoqda kuz sayli',
          today: TODAY,
          departmentSize: 18,
          recentEventTitles: ['Chorvoqda kuz sayli'],
        },
        check: (out: unknown, input: Record<string, unknown>) => {
          const recent = (input['recentEventTitles'] as string[]).map((t) => t.toLowerCase())
          return recent.includes((out as Draft).title.toLowerCase())
            ? 'repeated a recent event title verbatim'
            : null
        },
      },
      {
        id: 'event.any.attendees-bounded',
        feature: 'draft_event' as const,
        input: { locale: 'uz-Latn', idea: 'Chorvoqda kuz sayli', today: TODAY, departmentSize: 8 },
        check: (out: unknown, input: Record<string, unknown>) => {
          const size = input['departmentSize'] as number
          const n = (out as Draft).estimatedAttendees
          return n <= size ? null : `expected at most ${size} attendees, got ${n}`
        },
      },
      {
        id: 'event.ru.locale',
        feature: 'draft_event' as const,
        input: { locale: 'ru', idea: 'Осенний выезд на Чарвак', today: TODAY, departmentSize: 18 },
        check: (out: unknown) => scriptOf(out, 'cyrillic'),
      },
      {
        id: 'event.uz-latn.orthography',
        feature: 'draft_event' as const,
        input: {
          locale: 'uz-Latn',
          idea: "Bo'lim uchun kuzgi sayr",
          today: TODAY,
          departmentSize: 18,
        },
        check: (out: unknown) => orthography(out),
      },
      {
        id: 'event.any.no-emoji',
        feature: 'draft_event' as const,
        input: { locale: 'uz-Latn', idea: 'Chorvoqda kuz sayli', today: TODAY, departmentSize: 18 },
        check: (out: unknown) => {
          const emoji = strings(out).find((value) => /\p{Extended_Pictographic}/u.test(value))
          return emoji ? `emoji in output: ${emoji}` : null
        },
      },
    ]
  })(),

  // -------------------------------------------------------------- F7 summarize_thread (7 cases)
  ...(() => {
    type Thread = {
      decisions: { commentIds: string[] }[]
      openQuestions: { commentId: string }[]
      commitments: { who: string; byWhen: string | null; commentId: string }[]
      forViewer: string
    }
    const comments = [
      {
        id: 'k1',
        author: 'Anvar',
        text: 'Sentabr raqamlari boʻyicha kelishdik — 14 ta xizmat.',
        createdAt: '2026-09-10T09:00:00Z',
      },
      {
        id: 'k2',
        author: 'Nodira',
        text: 'Yakuniy PDF-ni ertaga yuboraman.',
        createdAt: '2026-09-10T10:00:00Z',
      },
      {
        id: 'k3',
        author: 'Dilnoza Karimova',
        text: 'Vazirlik shaklini kim toʻldiradi?',
        createdAt: '2026-09-10T11:00:00Z',
      },
    ]
    const base = {
      locale: 'uz-Latn',
      subject: { kind: 'card', id: 'c1', title: 'Byudjetni tasdiqlash' },
      viewerName: 'Dilnoza Karimova',
      comments,
    }
    const allIds = (input: Record<string, unknown>): Set<string> =>
      new Set((input['comments'] as { id: string }[]).map((comment) => comment.id))
    return [
      {
        id: 'thread.cites-only-given',
        feature: 'summarize_thread' as const,
        determinism: true,
        input: base,
        check: (out: unknown, input: Record<string, unknown>) => {
          const ids = allIds(input)
          const o = out as Thread
          const used = [
            ...o.decisions.flatMap((d) => d.commentIds),
            ...o.openQuestions.map((q) => q.commentId),
            ...o.commitments.map((c) => c.commentId),
          ]
          const bad = used.filter((id) => !ids.has(id))
          return bad.length === 0 ? null : `cited comment ids nobody supplied: ${bad.join(', ')}`
        },
      },
      {
        id: 'thread.who-exact',
        feature: 'summarize_thread' as const,
        input: base,
        check: (out: unknown, input: Record<string, unknown>) => {
          const authors = new Set((input['comments'] as { author: string }[]).map((c) => c.author))
          const bad = (out as Thread).commitments.find((c) => !authors.has(c.who))
          return bad ? `attributed a commitment to "${bad.who}", who is not an author here` : null
        },
      },
      {
        id: 'thread.no-decision',
        feature: 'summarize_thread' as const,
        input: {
          ...base,
          comments: [
            {
              id: 'q1',
              author: 'Anvar',
              text: 'Bu qachon tayyor boʻladi?',
              createdAt: '2026-09-10T09:00:00Z',
            },
            {
              id: 'q2',
              author: 'Dilnoza Karimova',
              text: 'Kim javobgar?',
              createdAt: '2026-09-10T10:00:00Z',
            },
          ],
        },
        check: (out: unknown) =>
          (out as Thread).decisions.length === 0
            ? null
            : 'manufactured a decision from a thread of nothing but questions',
      },
      {
        id: 'thread.bywhen-null',
        feature: 'summarize_thread' as const,
        input: base,
        check: (out: unknown) => {
          const invented = (out as Thread).commitments.find((c) => c.byWhen !== null)
          return invented
            ? `turned "ertaga" into the hard date ${invented.byWhen} — no date was stated`
            : null
        },
      },
      {
        id: 'thread.viewer',
        feature: 'summarize_thread' as const,
        input: base,
        check: (out: unknown) =>
          (out as Thread).forViewer.trim().length > 0
            ? null
            : 'the viewer asked an unanswered question and forViewer is empty',
      },
      {
        id: 'thread.order',
        feature: 'summarize_thread' as const,
        input: {
          ...base,
          comments: [
            {
              id: 'd1',
              author: 'Anvar',
              text: 'Birinchi masala boʻyicha kelishdik.',
              createdAt: '2026-09-10T09:00:00Z',
            },
            {
              id: 'd2',
              author: 'Nodira',
              text: 'Ikkinchi masala boʻyicha ham kelishdik.',
              createdAt: '2026-09-10T12:00:00Z',
            },
          ],
        },
        check: (out: unknown) => {
          const decisions = (out as Thread).decisions
          if (decisions.length < 2) return null
          return decisions[0]!.commentIds[0] === 'd1'
            ? null
            : 'decisions are not in chronological order'
        },
      },
      {
        id: 'thread.uz-latn.orthography',
        feature: 'summarize_thread' as const,
        input: base,
        check: (out: unknown) => orthography(out),
      },
    ]
  })(),

  // -------------------------------------------------------------- F8 nl_analytics (7 cases)
  ...(() => {
    type Ask = {
      filterText: string
      metric: string | null
      groupBy: string
      unmappedTerms: string[]
      confidence: string
      restatement: string
    }
    const base = {
      locale: 'uz-Latn',
      today: TODAY,
      knownUnits: ['Data boʻlimi', 'Kadrlar boʻlimi'],
      knownLabels: ['EGDI', 'hisobot'],
      knownProjects: ['EGDI paketi'],
      knownMembers: [
        { name: 'Nodira Karimova', handle: 'nodira' },
        { name: 'Anvar Aliyev', handle: 'anvar' },
      ],
      dateRange: { since: '2026-08-12', until: TODAY },
    }
    const tokens = (filterText: string): Array<[string, string]> => {
      const re = /([A-Za-z]+):"([^"]*)"|([A-Za-z]+):(\S+)/g
      const out: Array<[string, string]> = []
      let m: RegExpExecArray | null
      while ((m = re.exec(filterText))) {
        const key = (m[1] ?? m[3])!.toLowerCase()
        out.push([key, (m[2] ?? m[4])!])
      }
      return out
    }
    return [
      {
        id: 'analytics.uz-latn.overdue-unit',
        feature: 'nl_analytics' as const,
        determinism: true,
        input: { ...base, query: 'Data boʻlimining muddati oʻtgan kartochkalari' },
        check: (out: unknown) => {
          const unit = tokens((out as Ask).filterText).find(([key]) => key === 'unit')
          return unit?.[1] === 'Data boʻlimi'
            ? null
            : `expected a unit clause naming "Data boʻlimi", got ${String(unit?.[1])}`
        },
      },
      {
        id: 'analytics.uz-latn.this-month',
        feature: 'nl_analytics' as const,
        input: { ...base, query: 'Bu oy muddati oʻtgan kartochkalar' },
        check: (out: unknown) => {
          const due = tokens((out as Ask).filterText).filter(([key]) => key === 'due')
          return due.length >= 2
            ? null
            : `expected two due: clauses bounding the month, got ${due.length}`
        },
      },
      {
        id: 'analytics.ru.who-most',
        feature: 'nl_analytics' as const,
        input: { ...base, locale: 'ru', query: 'Кто больше всех просрочил?' },
        check: (out: unknown) => {
          const o = out as Ask
          if (o.metric !== 'loadPerPerson')
            return `expected metric loadPerPerson, got ${String(o.metric)}`
          return o.groupBy === 'person' ? null : `expected groupBy person, got ${o.groupBy}`
        },
      },
      {
        id: 'analytics.any.no-invented-unit',
        feature: 'nl_analytics' as const,
        input: { ...base, query: 'Moliya boʻlimining vazifalari' },
        check: (out: unknown, input: Record<string, unknown>) => {
          const units = new Set((input['knownUnits'] as string[]).map((u) => u.toLowerCase()))
          const bad = tokens((out as Ask).filterText).find(
            ([key, value]) => key === 'unit' && !units.has(value.toLowerCase()),
          )
          return bad ? `invented the unit "${bad[1]}"` : null
        },
      },
      {
        id: 'analytics.any.assignee-handle',
        feature: 'nl_analytics' as const,
        input: { ...base, query: 'Nodiraning ochiq vazifalari' },
        check: (out: unknown, input: Record<string, unknown>) => {
          const handles = new Set(
            (input['knownMembers'] as { handle: string }[]).map((m) => m.handle.toLowerCase()),
          )
          const bad = tokens((out as Ask).filterText).find(
            ([key, value]) =>
              key === 'assignee' &&
              value !== '@me' &&
              !handles.has(value.replace(/^@/, '').toLowerCase()),
          )
          return bad ? `used a handle nobody has: ${bad[1]}` : null
        },
      },
      {
        id: 'analytics.any.unmapped',
        feature: 'nl_analytics' as const,
        input: { ...base, query: 'Nodira qanchalik samarali ishlayapti?' },
        check: (out: unknown) => {
          const o = out as Ask
          if (o.unmappedTerms.length === 0)
            return '"samarali" was silently dropped instead of reported'
          return o.confidence !== 'high'
            ? null
            : 'reported high confidence despite an unmapped term'
        },
      },
      {
        id: 'analytics.uz-latn.restatement-localised',
        feature: 'nl_analytics' as const,
        input: { ...base, query: 'Muddati oʻtgan kartochkalar' },
        check: (out: unknown) => {
          const o = out as Ask
          // The restatement is the only human-facing field; the filter text is machine syntax.
          return all(
            orthography({ restatement: o.restatement }),
            scriptOf({ r: o.restatement }, 'latin'),
          )
        },
      },
    ]
  })(),

  // ------------------------------------------------------------------- F9 translate (7 cases)
  ...(() => {
    type Translation = {
      translatedText: string
      alreadyInTarget: boolean
      detectedSourceLocale: string | null
    }
    const glossary = [
      { source: 'vazifa', target: 'задача' },
      { source: 'muddat', target: 'срок' },
      { source: 'boʻlim', target: 'отдел' },
    ]
    return [
      {
        id: 'translate.uz-latn-to-ru.terminology',
        feature: 'translate' as const,
        determinism: true,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'ru',
          sourceLocale: 'uz-Latn',
          text: 'Nodira, EGDI vazifasining muddati juma kuni tugaydi.',
          glossary,
          preserve: ['Nodira', 'EGDI'],
        },
        check: (out: unknown) => {
          const text = (out as Translation).translatedText
          return /задач/i.test(text) && /срок/i.test(text)
            ? null
            : `glossary terms missing from: ${text}`
        },
      },
      {
        id: 'translate.any.preserve-names',
        feature: 'translate' as const,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'ru',
          sourceLocale: 'uz-Latn',
          text: 'Nodira EGDI paketini tayyorlaydi.',
          glossary,
          preserve: ['Nodira', 'EGDI'],
        },
        check: (out: unknown, input: Record<string, unknown>) => {
          const text = (out as Translation).translatedText
          const missing = (input['preserve'] as string[]).find((needle) => !text.includes(needle))
          return missing ? `"${missing}" was not preserved verbatim` : null
        },
      },
      {
        id: 'translate.any.already-in-target',
        feature: 'translate' as const,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'uz-Latn',
          sourceLocale: 'uz-Latn',
          text: 'Yigʻilish ertaga boshlanadi.',
        },
        check: (out: unknown, input: Record<string, unknown>) => {
          const o = out as Translation
          if (!o.alreadyInTarget)
            return 'same-locale input was not reported as already in the target'
          return o.translatedText.trim() === (input['text'] as string).trim()
            ? null
            : 'text already in the target language was rewritten anyway'
        },
      },
      {
        id: 'translate.any.preserve-newlines',
        feature: 'translate' as const,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'ru',
          sourceLocale: 'uz-Latn',
          text: 'Birinchi qator.\nIkkinchi qator.\nUchinchi qator.',
          glossary,
        },
        check: (out: unknown, input: Record<string, unknown>) => {
          const linesIn = (input['text'] as string).split('\n').length
          const linesOut = (out as Translation).translatedText.split('\n').length
          return linesIn === linesOut ? null : `${linesIn} lines in, ${linesOut} out`
        },
      },
      {
        id: 'translate.to-uz-latn.orthography',
        feature: 'translate' as const,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'uz-Latn',
          sourceLocale: 'ru',
          text: 'Совещание начнётся завтра в 10:00.',
          glossary: [{ source: 'совещание', target: 'yigʻilish' }],
        },
        check: (out: unknown) => orthography(out),
      },
      {
        id: 'translate.any.no-commentary',
        feature: 'translate' as const,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'en',
          sourceLocale: 'uz-Latn',
          text: 'Yigʻilish ertaga boshlanadi.',
          glossary: [{ source: 'yigʻilish', target: 'meeting' }],
        },
        check: (out: unknown) => {
          const text = (out as Translation).translatedText.toLowerCase()
          return /^(here is|translation:|перевод|tarjima:)/.test(text.trim())
            ? 'the answer opens with meta-commentary instead of the translation'
            : null
        },
      },
      {
        id: 'translate.any.numbers-unchanged',
        feature: 'translate' as const,
        input: {
          locale: 'uz-Latn',
          targetLocale: 'ru',
          sourceLocale: 'uz-Latn',
          text: 'Yigʻilish 18-sentabr kuni soat 10:00 da boshlanadi.',
          preserve: ['10:00'],
        },
        check: (out: unknown) =>
          (out as Translation).translatedText.includes('10:00') ? null : 'the time was altered',
      },
    ]
  })(),

  // ------------------------------------------------------------------ N-1 draft_reply (4 cases)
  ...(() => {
    type Reply = { draft: string; answers: string[]; stillNeeded: string[] }
    const base = {
      locale: 'uz-Latn',
      subject: { kind: 'card', id: 'c1', title: 'Byudjetni tasdiqlash' },
      viewerName: 'Anvar Aliyev',
      viewerRole: 'member',
      comments: [
        {
          id: 'k3',
          author: 'Dilnoza',
          text: 'Anvar, vazirlik shaklini kim toʻldiradi?',
          createdAt: '2026-09-10T11:00:00Z',
        },
      ],
    }
    return [
      {
        id: 'reply.uz-latn.answers-the-question',
        feature: 'draft_reply' as const,
        input: { ...base, tone: 'neutral', intent: 'men toʻldiraman' },
        check: (out: unknown, input: Record<string, unknown>) => {
          const ids = new Set((input['comments'] as { id: string }[]).map((c) => c.id))
          const bad = (out as Reply).answers.filter((id) => !ids.has(id))
          return bad.length === 0 ? null : `answered comment ids nobody supplied: ${bad.join(', ')}`
        },
      },
      {
        id: 'reply.any.no-placeholder',
        feature: 'draft_reply' as const,
        input: { ...base, tone: 'formal', intent: '' },
        check: (out: unknown) =>
          /\[[^\]]{2,40}\]|\{\{[^}]+\}\}/.test((out as Reply).draft)
            ? 'the draft contains a placeholder a person would have to find and fill'
            : null,
      },
      {
        id: 'reply.any.flags-missing-date',
        feature: 'draft_reply' as const,
        input: { ...base, tone: 'neutral', intent: '' },
        check: (out: unknown) =>
          (out as Reply).stillNeeded.length > 0
            ? null
            : 'drafted a reply to an open question with no intent, and flagged nothing as missing',
      },
      {
        id: 'reply.uz-latn.orthography',
        feature: 'draft_reply' as const,
        input: { ...base, tone: 'neutral', intent: 'shaklni men toʻldiraman' },
        check: (out: unknown) => orthography(out),
      },
    ]
  })(),

  // ------------------------------------------------------------ N-2 board_risk_digest (4 cases)
  ...(() => {
    type Digest = {
      entries: { cardId: string; rank: number; suggestedAction: string }[]
      pressurePoints: { name: string }[]
    }
    const base = {
      locale: 'uz-Latn',
      departmentName: 'Raqamli xizmatlar boshqarmasi',
      today: TODAY,
      topN: 3,
      cards: [
        {
          id: 'c9',
          title: 'EGDI paketi',
          riskLevel: 'overdue',
          assigneeName: 'Nodira',
          daysOverdue: 5,
          daysSinceUpdate: 9,
          checklistDone: 1,
          checklistTotal: 4,
        },
        {
          id: 'c4',
          title: 'Byudjet jadvali',
          riskLevel: 'at_risk',
          assigneeName: 'Anvar',
          dueDate: '2026-09-14',
          checklistDone: 0,
          checklistTotal: 3,
        },
        {
          id: 'c7',
          title: 'Sayt matni',
          riskLevel: 'at_risk',
          assigneeName: 'Anvar',
          dueDate: '2026-09-15',
          checklistDone: 2,
          checklistTotal: 3,
          blocked: true,
        },
        {
          id: 'c1',
          title: 'Hammasi joyida',
          riskLevel: 'none',
          assigneeName: 'Dilnoza',
          checklistDone: 3,
          checklistTotal: 3,
        },
      ],
      loadPerPerson: [
        { name: 'Anvar', openCount: 9 },
        { name: 'Nodira', openCount: 4 },
      ],
    }
    return [
      {
        id: 'digest.only-risky-cards',
        feature: 'board_risk_digest' as const,
        determinism: true,
        input: base,
        check: (out: unknown, input: Record<string, unknown>) => {
          const risky = new Set(
            (input['cards'] as { id: string; riskLevel: string }[])
              .filter((card) => card.riskLevel !== 'none')
              .map((card) => card.id),
          )
          const bad = (out as Digest).entries.find((entry) => !risky.has(entry.cardId))
          return bad ? `ranked "${bad.cardId}", which the system reports as not at risk` : null
        },
      },
      {
        id: 'digest.respects-topN',
        feature: 'board_risk_digest' as const,
        input: { ...base, topN: 2 },
        check: (out: unknown) => {
          const n = (out as Digest).entries.length
          return n <= 2 ? null : `topN was 2 and ${n} entries came back`
        },
      },
      {
        id: 'digest.blocked-action',
        feature: 'board_risk_digest' as const,
        input: base,
        check: (out: unknown) => {
          const blocked = (out as Digest).entries.find((entry) => entry.cardId === 'c7')
          if (!blocked) return null
          return blocked.suggestedAction === 'mark_blocked'
            ? null
            : `a blocked card got "${blocked.suggestedAction}"`
        },
      },
      {
        id: 'digest.pressure-grounded',
        feature: 'board_risk_digest' as const,
        input: base,
        check: (out: unknown, input: Record<string, unknown>) => {
          const known = new Set((input['loadPerPerson'] as { name: string }[]).map((p) => p.name))
          const bad = (out as Digest).pressurePoints.find((point) => !known.has(point.name))
          return bad ? `named "${bad.name}", who is not in loadPerPerson` : null
        },
      },
    ]
  })(),

  // ------------------------------------------------------------- N-3 suggest_assignee (4 cases)
  ...(() => {
    type Suggest = {
      suggestions: { userId: string; reason: string; loadWarning: string }[]
      note: string
    }
    const base = {
      locale: 'uz-Latn',
      card: { id: 'c1', title: 'EGDI koʻrsatkichlarini yangilash', labels: ['EGDI'] },
      candidates: [
        {
          userId: 'u1',
          fullName: 'Nodira Karimova',
          openCount: 4,
          overdueCount: 1,
          recentLabels: ['EGDI', 'hisobot'],
        },
        {
          userId: 'u2',
          fullName: 'Anvar Aliyev',
          openCount: 9,
          overdueCount: 2,
          recentLabels: ['sayt'],
        },
        {
          userId: 'u3',
          fullName: 'Dilnoza Karimova',
          openCount: 2,
          overdueCount: 0,
          recentLabels: [],
        },
      ],
    }
    return [
      {
        id: 'assignee.only-known-people',
        feature: 'suggest_assignee' as const,
        determinism: true,
        input: base,
        check: (out: unknown, input: Record<string, unknown>) => {
          const ids = new Set((input['candidates'] as { userId: string }[]).map((c) => c.userId))
          const bad = (out as Suggest).suggestions.find((s) => !ids.has(s.userId))
          return bad ? `suggested "${bad.userId}", who is not a candidate` : null
        },
      },
      {
        id: 'assignee.no-performance-language',
        feature: 'suggest_assignee' as const,
        input: base,
        check: (out: unknown) => {
          const banned =
            /\b(tezroq|yaxshiroq|ishonchli|быстрее|лучше|надёжн|faster|better|more reliable|more competent)\b/i
          const bad = (out as Suggest).suggestions.find(
            (s) => banned.test(s.reason) || banned.test(s.loadWarning),
          )
          return bad ? `a reason judged a person: "${bad.reason}"` : null
        },
      },
      {
        id: 'assignee.load-warning-on-the-loaded-one',
        feature: 'suggest_assignee' as const,
        input: base,
        check: (out: unknown) => {
          const anvar = (out as Suggest).suggestions.find((s) => s.userId === 'u2')
          if (!anvar) return null
          return anvar.loadWarning.trim().length > 0
            ? null
            : 'suggested the person carrying 9 open items with no load warning'
        },
      },
      {
        id: 'assignee.everyone-away',
        feature: 'suggest_assignee' as const,
        input: {
          ...base,
          candidates: (base.candidates as Array<Record<string, unknown>>).map((c) => ({
            ...c,
            away: true,
          })),
        },
        check: (out: unknown) => {
          const o = out as Suggest
          if (o.suggestions.length > 0) return 'suggested somebody who is away'
          return o.note.trim().length > 0 ? null : 'returned nothing and explained nothing'
        },
      },
    ]
  })(),

  // -------------------------------------------------------------- N-5 duplicate_check (4 cases)
  ...(() => {
    type Dup = { matches: { cardId: string; relation: string }[]; verdict: string }
    return [
      {
        id: 'duplicate.finds-the-same-work',
        feature: 'duplicate_check' as const,
        determinism: true,
        input: {
          locale: 'uz-Latn',
          candidateTitle: 'EGDI koʻrsatkichlarini yigʻish',
          existing: [
            {
              id: 'c4',
              title: 'EGDI koʻrsatkichlari boʻyicha maʼlumot yigʻish',
              status: 'active',
              similarity: 0.82,
            },
            {
              id: 'c9',
              title: 'EGDI paketini vazirlikka yuborish',
              status: 'active',
              similarity: 0.44,
            },
          ],
        },
        check: (out: unknown) =>
          (out as Dup).verdict === 'duplicate' ? null : 'missed an obvious duplicate',
      },
      {
        id: 'duplicate.none-when-unrelated',
        feature: 'duplicate_check' as const,
        input: {
          locale: 'uz-Latn',
          candidateTitle: 'Yangi printer sotib olish',
          existing: [
            { id: 'c2', title: 'Sayt matnini tahrirlash', status: 'active', similarity: 0.11 },
          ],
        },
        check: (out: unknown) =>
          (out as Dup).verdict === 'none' ? null : 'flagged an unrelated item as a duplicate',
      },
      {
        id: 'duplicate.only-known-ids',
        feature: 'duplicate_check' as const,
        input: {
          locale: 'uz-Latn',
          candidateTitle: 'EGDI koʻrsatkichlarini yigʻish',
          existing: [
            {
              id: 'c4',
              title: 'EGDI koʻrsatkichlarini yigʻish',
              status: 'active',
              similarity: 0.9,
            },
          ],
        },
        check: (out: unknown, input: Record<string, unknown>) => {
          const ids = new Set((input['existing'] as { id: string }[]).map((item) => item.id))
          const bad = (out as Dup).matches.find((match) => !ids.has(match.cardId))
          return bad ? `named an item nobody supplied: ${bad.cardId}` : null
        },
      },
      {
        id: 'duplicate.verdict-matches-matches',
        feature: 'duplicate_check' as const,
        input: {
          locale: 'uz-Latn',
          candidateTitle: 'EGDI paketini vazirlikka yuborish',
          existing: [
            {
              id: 'c9',
              title: 'EGDI koʻrsatkichlarini yigʻish',
              status: 'active',
              similarity: 0.5,
            },
          ],
        },
        check: (out: unknown) => {
          const o = out as Dup
          const hasDuplicate = o.matches.some((match) => match.relation === 'duplicate')
          if (o.verdict === 'duplicate' && !hasDuplicate)
            return 'verdict says duplicate but no match is one'
          if (o.verdict === 'none' && o.matches.length > 0)
            return 'verdict says none but matches were returned'
          return null
        },
      },
    ]
  })(),

  // ----------------------------------------------------------------- L2 semantic_ask (4 cases)
  ...(() => {
    type Answer = { answer: string; answered: boolean; citations: string[]; followUp: string }
    return [
      {
        id: 'ask.cites-what-it-used',
        feature: 'semantic_ask' as const,
        determinism: true,
        input: {
          locale: 'uz-Latn',
          question: 'EGDI paketini kim tayyorlayapti?',
          backend: 'fts',
          passages: [
            {
              ref: 'card:c9',
              kind: 'card',
              id: 'c9',
              title: 'EGDI paketini tayyorlash',
              excerpt: 'Masʼul: Nodira Karimova. Muddat 18-sentabr.',
              score: 0.81,
            },
          ],
        },
        check: (out: unknown, input: Record<string, unknown>) => {
          const refs = new Set((input['passages'] as { ref: string }[]).map((p) => p.ref))
          const o = out as Answer
          if (o.answered && o.citations.length === 0) return 'answered with no citation at all'
          const bad = o.citations.filter((ref) => !refs.has(ref))
          return bad.length === 0 ? null : `cited passages nobody supplied: ${bad.join(', ')}`
        },
      },
      {
        id: 'ask.says-not-found',
        feature: 'semantic_ask' as const,
        input: {
          locale: 'uz-Latn',
          question: 'Yangi avtomobil xarid qilish tartibi qanday?',
          backend: 'fts',
          passages: [
            {
              ref: 'page:p2',
              kind: 'page',
              id: 'p2',
              title: 'Ichki tartib',
              excerpt: 'Ish vaqti 9:00 dan 18:00 gacha.',
              score: 0.12,
            },
          ],
        },
        check: (out: unknown) => {
          const o = out as Answer
          if (o.answered) return 'answered a question the passages do not cover'
          return o.followUp.trim().length > 0 ? null : 'said nothing and offered no way forward'
        },
      },
      {
        id: 'ask.empty-retrieval',
        feature: 'semantic_ask' as const,
        input: { locale: 'uz-Latn', question: 'Byudjet qancha?', backend: 'fts', passages: [] },
        check: (out: unknown) =>
          (out as Answer).answered ? 'answered with no passages at all' : null,
      },
      {
        id: 'ask.uz-latn.orthography',
        feature: 'semantic_ask' as const,
        input: { locale: 'uz-Latn', question: 'Byudjet qancha?', backend: 'fts', passages: [] },
        check: (out: unknown) => orthography(out),
      },
    ]
  })(),
]

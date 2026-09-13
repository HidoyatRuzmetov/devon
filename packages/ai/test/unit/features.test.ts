// Every feature, end to end, against the offline simulator only -- the same path a from-scratch
// clone or a demo box with no `AI_API_KEY` actually takes in production (TECH-SPEC §8's "mock
// provider ... for when no key is configured", wired via `createProvider`/`buildOfflineRespond`).
//
// v1.1 adds the three cross-cutting assertions the audit found nobody was making: every simulator
// answers in the caller's locale, every `validateOutput` accepts its own simulator's answer, and
// every uz-Latn answer is orthographically correct.
import { describe, expect, it } from 'vitest'
import { loadAiConfig } from '../../src/config.js'
import { createProvider } from '../../src/index.js'
import { AI_FEATURES, type AiFeature } from '../../src/types.js'
import { FEATURE_REGISTRY, runFeature } from '../../src/features.js'
import { hasAsciiApostrophe } from '../../src/uz.js'

const config = loadAiConfig({}) // no AI_API_KEY -> createProvider hands back the offline MockProvider

const MEMBERS = [
  { userId: 'u1', fullName: 'Nodira Karimova', givenName: 'Nodira', handle: 'nodira' },
  { userId: 'u2', fullName: 'Anvar Aliyev', givenName: 'Anvar', handle: 'anvar' },
]

/** One believable input per feature, in uz-Latn, so the locale assertions below mean something. */
const SAMPLE_INPUT: Record<AiFeature, Record<string, unknown>> = {
  quick_add_parse: {
    locale: 'uz-Latn',
    text: 'Nodiraga hisobotni jumagacha tayyorlashni topshir, shoshilinch',
    today: '2026-09-12',
    members: MEMBERS,
    labels: [{ id: 'l1', name: 'hisobot' }],
    projects: [],
  },
  subtask_breakdown: {
    locale: 'uz-Latn',
    cardTitle: 'EGDI paketini tayyorlash',
    labels: ['EGDI'],
    dueInDays: 5,
  },
  plan_sprint: {
    locale: 'uz-Latn',
    scope: 'personal',
    periodKind: 'day',
    now: '2026-09-12T09:00:00+05:00',
    periodEndsAt: '2026-09-12T18:00:00+05:00',
    capacityMin: 420,
    items: [
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
    ],
  },
  deadline_risk: {
    locale: 'uz-Latn',
    card: {
      id: 'c1',
      title: 'Choraklik hisobot',
      riskLevel: 'overdue',
      dueDate: '2026-09-01',
      today: '2026-09-08',
      checklistTotal: 4,
      checklistDone: 1,
      daysSinceUpdate: 10,
      assigneeName: 'Nodira Karimova',
    },
  },
  catch_up: {
    locale: 'uz-Latn',
    scope: 'department',
    window: 'week',
    subjectName: 'Raqamli xizmatlar boshqarmasi',
    viewerName: 'Anvar Aliyev',
    period: { start: '2026-09-05', end: '2026-09-12' },
    counts: { done: 14, doneLastPeriod: 11, created: 9, overdue: 1 },
    done: [{ id: 'c3', title: 'Choraklik hisobot' }],
    overdue: [
      {
        id: 'c9',
        title: 'EGDI paketi',
        assigneeName: 'Nodira',
        daysOverdue: 5,
        daysSinceUpdate: 9,
      },
    ],
    dueThisWeek: [{ id: 'c21', title: 'Sayt matni', assigneeName: 'Anvar', dueDate: '2026-09-16' }],
    loadPerPerson: [
      { name: 'Anvar', openCount: 9, overdueCount: 2 },
      { name: 'Nodira', openCount: 4, overdueCount: 1 },
      { name: 'Dilnoza', openCount: 3, overdueCount: 0 },
    ],
  },
  draft_event: {
    locale: 'uz-Latn',
    idea: 'Chorvoqda kuz sayli',
    category: 'team_building',
    today: '2026-09-12',
    departmentSize: 18,
  },
  summarize_thread: {
    locale: 'uz-Latn',
    subject: { kind: 'card', id: 'c1', title: 'Byudjetni tasdiqlash' },
    viewerName: 'Dilnoza Karimova',
    comments: [
      {
        id: 'k1',
        author: 'Anvar',
        text: 'Sentabr raqamlari boʻyicha kelishdik.',
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
    ],
  },
  nl_analytics: {
    locale: 'uz-Latn',
    query: 'Bu oy Data boʻlimining muddati oʻtgan kartochkalari',
    today: '2026-09-12',
    knownUnits: ['Data boʻlimi'],
    knownMembers: [{ name: 'Nodira Karimova', handle: 'nodira' }],
    dateRange: { since: '2026-08-12', until: '2026-09-12' },
  },
  translate: {
    locale: 'uz-Latn',
    targetLocale: 'ru',
    sourceLocale: 'uz-Latn',
    text: 'Nodira, EGDI vazifasining muddati juma kuni tugaydi.',
    glossary: [
      { source: 'vazifa', target: 'задача' },
      { source: 'muddat', target: 'срок' },
    ],
    preserve: ['Nodira', 'EGDI'],
  },
  draft_reply: {
    locale: 'uz-Latn',
    subject: { kind: 'card', id: 'c1', title: 'Byudjetni tasdiqlash' },
    viewerName: 'Anvar Aliyev',
    viewerRole: 'member',
    tone: 'neutral',
    intent: 'men toʻldiraman',
    comments: [
      {
        id: 'k3',
        author: 'Dilnoza',
        text: 'Anvar, vazirlik shaklini kim toʻldiradi?',
        createdAt: '2026-09-10T11:00:00Z',
      },
    ],
  },
  board_risk_digest: {
    locale: 'uz-Latn',
    departmentName: 'Raqamli xizmatlar boshqarmasi',
    today: '2026-09-12',
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
    ],
    loadPerPerson: [
      { name: 'Anvar', openCount: 9 },
      { name: 'Nodira', openCount: 4 },
    ],
  },
  suggest_assignee: {
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
  },
  duplicate_check: {
    locale: 'uz-Latn',
    candidateTitle: 'EGDI koʻrsatkichlarini yigʻish',
    existing: [
      {
        id: 'c4',
        title: 'EGDI koʻrsatkichlari boʻyicha maʼlumot yigʻish',
        status: 'active',
        similarity: 0.82,
      },
      { id: 'c9', title: 'EGDI paketini vazirlikka yuborish', status: 'active', similarity: 0.44 },
    ],
  },
  semantic_ask: {
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
}

/** Every string leaf of a JSON-shaped value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) strings(item, out)
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) strings(child, out)
  }
  return out
}

describe('every feature spec', () => {
  it('is registered for every AiFeature', () => {
    for (const feature of AI_FEATURES) {
      expect(FEATURE_REGISTRY[feature]).toBeDefined()
      expect(FEATURE_REGISTRY[feature].feature).toBe(feature)
    }
  })

  it('has a sample input above for every feature (keeps this test honest as features are added)', () => {
    for (const feature of AI_FEATURES) {
      expect(SAMPLE_INPUT[feature], `missing SAMPLE_INPUT for "${feature}"`).toBeDefined()
    }
  })

  it('declares a temperature for every feature (AI-AUDIT G-2)', () => {
    for (const feature of AI_FEATURES) {
      const spec = FEATURE_REGISTRY[feature]
      expect(typeof spec.temperature, `"${feature}" has no temperature`).toBe('number')
      expect(spec.temperature).toBeGreaterThanOrEqual(0)
      expect(spec.temperature).toBeLessThanOrEqual(1)
    }
  })

  it('names its own tool exactly once in its own system prompt', () => {
    for (const feature of AI_FEATURES) {
      const spec = FEATURE_REGISTRY[feature]
      const prompt = spec.systemPrompt(spec.inputSchema.parse(SAMPLE_INPUT[feature]))
      expect(prompt, `"${feature}" never tells the model which tool to call`).toContain(
        spec.toolName,
      )
    }
  })

  for (const feature of AI_FEATURES) {
    it(`"${feature}": offline simulate() output satisfies its own output schema`, () => {
      const spec = FEATURE_REGISTRY[feature]
      const input = spec.inputSchema.parse(SAMPLE_INPUT[feature])
      const output = spec.simulate(input)
      expect(() => spec.outputSchema.parse(output)).not.toThrow()
    })

    it(`"${feature}": its own validateOutput accepts its own simulator's answer`, () => {
      const spec = FEATURE_REGISTRY[feature]
      if (!spec.validateOutput) return
      const input = spec.inputSchema.parse(SAMPLE_INPUT[feature])
      const verdict = spec.validateOutput(input, spec.simulate(input))
      expect(verdict.ok, verdict.ok ? '' : `rejected its own simulator: ${verdict.error}`).toBe(
        true,
      )
    })

    it(`"${feature}": runFeature() succeeds end to end via the offline provider`, async () => {
      const provider = createProvider(config)
      const result = await runFeature({ provider, config, feature, input: SAMPLE_INPUT[feature] })
      expect(result.ok, result.ok ? '' : `run failed: ${result.error}`).toBe(true)
      if (result.ok) {
        expect(result.meta?.feature).toBe(feature)
        expect(result.meta?.costUzs).toBeGreaterThanOrEqual(0)
        // v1.1 SPEC §8 "Honesty": the offline path must say so, so the UI can.
        expect(result.meta?.simulated).toBe(true)
      }
    })

    it(`"${feature}": every uz-Latn string it returns is orthographically correct`, async () => {
      const provider = createProvider(config)
      const result = await runFeature({ provider, config, feature, input: SAMPLE_INPUT[feature] })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // `translate` and `semantic_ask` echo caller-supplied text back (a Russian translation, a
      // passage excerpt); an apostrophe there is the author's, not this package's.
      if (feature === 'translate' || feature === 'semantic_ask') return
      for (const value of strings(result.data)) {
        expect(
          hasAsciiApostrophe(value),
          `"${feature}" returned an ASCII apostrophe in: ${value}`,
        ).toBe(false)
      }
    })
  }

  it('rejects invalid input before ever building a provider call', async () => {
    const provider = createProvider(config)
    const result = await runFeature({
      provider,
      config,
      feature: 'translate',
      input: { locale: 'not-a-locale' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.meta).toBeNull()
  })
})

describe('catch_up — the citation guard rail (AI-AUDIT §0.6)', () => {
  it('only ever cites ids that were actually given as input', async () => {
    const provider = createProvider(config)
    const input = SAMPLE_INPUT['catch_up']
    const given = new Set<string>()
    for (const key of ['done', 'overdue', 'dueThisWeek'] as const) {
      for (const item of input[key] as { id: string }[]) given.add(item.id)
    }
    const result = await runFeature<{
      wins: { citedIds: string[] }
      lookingAhead: { citedIds: string[] }
      risks: { cardId: string }[]
    }>({ provider, config, feature: 'catch_up', input })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const id of [...result.data.wins.citedIds, ...result.data.lookingAhead.citedIds]) {
      expect(given.has(id)).toBe(true)
    }
    for (const risk of result.data.risks) expect(given.has(risk.cardId)).toBe(true)
  })

  it('drops an id the model invented rather than rendering it as a link', () => {
    const spec = FEATURE_REGISTRY['catch_up']
    const input = spec.inputSchema.parse(SAMPLE_INPUT['catch_up'])
    const verdict = spec.validateOutput!(input, {
      ...spec.simulate(input),
      wins: { text: 'x', citedIds: ['c3', 'NOT-A-REAL-ID'] },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.output.wins.citedIds).toEqual(['c3'])
  })
})

describe('plan_sprint — faithfulness is rejected, not repaired (AI-AUDIT §3 F3)', () => {
  it('refuses a plan that dropped one of the items it was given', () => {
    const spec = FEATURE_REGISTRY['plan_sprint']
    const input = spec.inputSchema.parse(SAMPLE_INPUT['plan_sprint'])
    const verdict = spec.validateOutput!(input, {
      ...spec.simulate(input),
      orderedIds: ['t1', 't2', 't3'],
    })
    expect(verdict.ok).toBe(false)
  })

  it('refuses a plan that puts a blocked item before its blocker', () => {
    const spec = FEATURE_REGISTRY['plan_sprint']
    const input = spec.inputSchema.parse({
      ...SAMPLE_INPUT['plan_sprint'],
      items: [
        { id: 'a', title: 'Blocker', estimateMin: 30 },
        { id: 'b', title: 'Blocked', estimateMin: 30, blockedByIds: ['a'] },
      ],
    })
    const verdict = spec.validateOutput!(input, {
      orderedIds: ['b', 'a'],
      focusId: 'b',
      reasons: [
        { id: 'b', reason: 'x' },
        { id: 'a', reason: 'y' },
      ],
      wontFitIds: [],
      overCommittedByMin: 0,
      summary: 'x',
    })
    expect(verdict.ok).toBe(false)
  })
})

describe('suggest_assignee — the performance-judgement guard rail', () => {
  it('refuses a reason that compares one person with another', () => {
    const spec = FEATURE_REGISTRY['suggest_assignee']
    const input = spec.inputSchema.parse(SAMPLE_INPUT['suggest_assignee'])
    const verdict = spec.validateOutput!(input, {
      suggestions: [
        {
          userId: 'u1',
          rank: 1,
          reason: 'Nodira Anvardan tezroq ishlaydi',
          loadWarning: '',
          confidence: 'high',
        },
      ],
      note: '',
    })
    expect(verdict.ok).toBe(false)
  })
})

describe('semantic_ask — no citation, no answer', () => {
  it('refuses an answer that cites nothing it was given', () => {
    const spec = FEATURE_REGISTRY['semantic_ask']
    const input = spec.inputSchema.parse(SAMPLE_INPUT['semantic_ask'])
    const verdict = spec.validateOutput!(input, {
      answer: 'Bu ishni Anvar bajaryapti.',
      answered: true,
      citations: ['card:invented'],
      followUp: '',
    })
    expect(verdict.ok).toBe(false)
  })
})

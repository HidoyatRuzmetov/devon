// Every feature, end to end, against the offline simulator only -- the same path a from-scratch
// clone or a demo box with no `AI_API_KEY` actually takes in production (TECH-SPEC §8's "mock
// provider ... for when no key is configured", wired via `createProvider`/`buildOfflineRespond`).
import { describe, expect, it } from 'vitest'
import { loadAiConfig } from '../../src/config.js'
import { createProvider } from '../../src/index.js'
import { AI_FEATURES } from '../../src/types.js'
import { FEATURE_REGISTRY, runFeature } from '../../src/features.js'

const config = loadAiConfig({}) // no AI_API_KEY -> createProvider hands back the offline MockProvider

const SAMPLE_INPUT: Record<string, unknown> = {
  quick_add_parse: {
    locale: 'en',
    text: 'Assign Nodira the report by tomorrow',
    memberNames: ['Nodira Karimova'],
  },
  subtask_breakdown: {
    locale: 'en',
    cardTitle: 'Launch the new intranet page',
    cardDescription: 'Draft copy. Get sign-off. Publish.',
  },
  plan_sprint: {
    locale: 'en',
    sprintKind: 'day',
    goal: 'Clear the inbox',
    tasks: [{ title: 'Reply to emails', estimateMin: 30 }, { title: 'Write report' }],
  },
  deadline_risk: {
    locale: 'en',
    cardTitle: 'Quarterly report',
    dueDate: '2026-09-10',
    today: '2026-09-08',
    checklistTotal: 4,
    checklistDone: 1,
    daysSinceUpdate: 5,
  },
  weekly_summary: {
    locale: 'en',
    scope: 'person',
    subjectName: 'Nodira Karimova',
    periodLabel: 'this week',
    doneCards: [{ id: 'c1', title: 'Report' }],
    overdueCards: [],
    newCards: [{ id: 'c2', title: 'New task' }],
  },
  draft_event: { locale: 'en', idea: 'Autumn picnic at Chorvoq' },
  summarize_thread: {
    locale: 'en',
    cardTitle: 'Budget approval',
    comments: [
      { id: 'k1', author: 'Anvar', text: 'We agreed on the September figures.' },
      { id: 'k2', author: 'Nodira', text: 'I will send the final PDF tomorrow.' },
    ],
  },
  nl_analytics: {
    locale: 'en',
    query: "overdue cards of Data bo'limi this month",
    knownUnits: ["Data bo'limi"],
  },
  translate: { locale: 'ru', text: 'Hello, how are you?' },
  what_did_i_miss: {
    locale: 'en',
    sinceLabel: 'Friday',
    newCards: [{ id: 'n1', title: 'New card' }],
    commentsOnMyCards: [],
    upcomingEvents: [],
  },
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

  for (const feature of AI_FEATURES) {
    it(`"${feature}": offline simulate() output satisfies its own output schema`, () => {
      const spec = FEATURE_REGISTRY[feature]
      const input = spec.inputSchema.parse(SAMPLE_INPUT[feature])
      const output = spec.simulate(input)
      expect(() => spec.outputSchema.parse(output)).not.toThrow()
    })

    it(`"${feature}": runFeature() succeeds end to end via the offline provider`, async () => {
      const provider = createProvider(config)
      const result = await runFeature({ provider, config, feature, input: SAMPLE_INPUT[feature] })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meta?.feature).toBe(feature)
        expect(result.meta?.costUzs).toBeGreaterThanOrEqual(0)
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

describe('weekly_summary — citation guard rail', () => {
  it('only ever cites ids that were actually given as input', async () => {
    const provider = createProvider(config)
    const input = SAMPLE_INPUT['weekly_summary'] as {
      doneCards: { id: string }[]
      overdueCards: { id: string }[]
      newCards: { id: string }[]
    }
    const givenIds = new Set(
      [...input.doneCards, ...input.overdueCards, ...input.newCards].map((c) => c.id),
    )
    const result = await runFeature<{ highlightIds: string[] }>({
      provider,
      config,
      feature: 'weekly_summary',
      input,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      for (const id of result.data.highlightIds) expect(givenIds.has(id)).toBe(true)
    }
  })
})

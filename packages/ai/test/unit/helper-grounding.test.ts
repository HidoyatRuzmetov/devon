import { describe, expect, it } from 'vitest'
import { planSprintSpec } from '../../src/prompts/plan-sprint.js'
import { draftReplySpec } from '../../src/prompts/draft-reply.js'
import { quickAddParseSpec } from '../../src/prompts/quick-add-parse.js'
import { nlAnalyticsSpec } from '../../src/prompts/nl-analytics.js'
import { catchUpSpec } from '../../src/prompts/catch-up.js'
import { draftEventOutputSchema, draftEventSpec } from '../../src/prompts/draft-event.js'
import { runFeature } from '../../src/features.js'
import { loadAiConfig } from '../../src/config.js'
import { MockProvider } from '../../src/mock-provider.js'

describe('helper-specific grounding', () => {
  it('does not assert punctual completion or invent colleague assignments in a private recap', () => {
    const input = catchUpSpec.inputSchema.parse({
      locale: 'en',
      scope: 'person',
      privateWorkspace: true,
      window: 'week',
      subjectName: 'Nodira',
      viewerName: 'Nodira',
      period: { start: '2026-10-01', end: '2026-10-08' },
      counts: { done: 9, doneLastPeriod: 7, created: 1, overdue: 0 },
      done: [{ id: 'a', title: 'Audit' }],
      assignedToMe: [{ id: 'b', title: 'Self-created task' }],
    })
    const output = catchUpSpec.simulate(input)
    expect(output.wins.text).toBe('9 item(s) were closed.')
    expect(output.headline).toContain('9 items closed')
    expect(output.items[0]!.text).toBe('Self-created task')
    expect(output.items[0]!.text).not.toContain('assigned')
  })
  it('refuses impossible event start times before a draft can populate a form', () => {
    expect(
      draftEventOutputSchema.shape.dateOptions.element.shape.startTime.safeParse('25:70').success,
    ).toBe(false)
    expect(
      draftEventOutputSchema.shape.dateOptions.element.shape.startTime.safeParse('23:59').success,
    ).toBe(true)
  })
  it('uses the true large department size while keeping proposed attendance within form limits', () => {
    const input = draftEventSpec.inputSchema.parse({
      locale: 'en',
      idea: 'Team training',
      today: '2026-10-08',
      departmentSize: 1200,
    })
    const output = draftEventSpec.simulate(input)
    expect(output.estimatedAttendees).toBe(500)
    expect(draftEventOutputSchema.safeParse(output).success).toBe(true)
  })
  const plan = {
    locale: 'en',
    scope: 'project',
    periodKind: 'custom',
    now: '2026-10-08T09:00:00+05:00',
    periodEndsAt: '2026-10-09T18:00:00+05:00',
    capacityMin: null,
    items: [
      { id: 'a', title: 'Audit', estimateMin: 90 },
      { id: 'b', title: 'Write findings', estimateMin: 60 },
    ],
  }
  it('does not invent zero capacity or claim unknown estimates fit', () => {
    const input = planSprintSpec.inputSchema.parse(plan)
    const raw = {
      orderedIds: ['a', 'b'],
      focusId: 'b',
      reasons: [
        { id: 'a', reason: 'Required first' },
        { id: 'a', reason: 'Replaces duplicate' },
        { id: 'b', reason: 'Follow the audit' },
      ],
      wontFitIds: ['a', 'b'],
      overCommittedByMin: 150,
      summary: 'Everything will fit today.',
    }
    const result = planSprintSpec.validateOutput!(input, raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.output.wontFitIds).toEqual([])
      expect(result.output.overCommittedByMin).toBe(0)
      expect(result.output.summary).toContain('cannot yet be assessed')
      expect(result.output.focusId).toBe('a')
      expect(result.output.reasons).toHaveLength(2)
    }
    const missing = planSprintSpec.simulate(
      planSprintSpec.inputSchema.parse({
        ...plan,
        capacityMin: 240,
        items: [{ id: 'a', title: 'Audit', estimateMin: null }],
      }),
    )
    expect(missing.summary).toContain('cannot yet be assessed')
  })
  it('measures capacity in returned order instead of trusting generated arithmetic', () => {
    const input = planSprintSpec.inputSchema.parse({ ...plan, capacityMin: 100 })
    const raw = planSprintSpec.simulate(input)
    const result = planSprintSpec.validateOutput!(input, {
      ...raw,
      orderedIds: ['a', 'b'],
      wontFitIds: [],
      overCommittedByMin: 0,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.output.wontFitIds).toEqual(['b'])
      expect(result.output.overCommittedByMin).toBe(50)
    }
  })
  for (const locale of ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const)
    it(`does not invent a reply deadline in ${locale}`, () => {
      const input = draftReplySpec.inputSchema.parse({
        locale,
        subject: { kind: 'card', id: 'c', title: 'Audit' },
        viewerName: 'Nodira Karimova',
        viewerRole: 'member',
        comments: [
          {
            id: 'k',
            author: 'Anvar Aliyev',
            text: 'When will this be ready?',
            createdAt: '2026-10-08T09:00:00Z',
          },
        ],
      })
      const result = draftReplySpec.simulate(input)
      expect(result.draft).not.toMatch(/bugun|бугун|конца дня|end of.*day/)
      expect(result.stillNeeded).not.toEqual([])
    })
  it('keeps explicitly typed past dates, including day-month-year notation', () => {
    for (const text of ['Hisobot 17.09', 'Hisobot 17/09/2025', 'Hisobot 2025-09-17']) {
      const input = quickAddParseSpec.inputSchema.parse({
        locale: 'uz-Latn',
        today: '2026-10-08',
        text,
      })
      const raw = quickAddParseSpec.simulate(input)
      const result = quickAddParseSpec.validateOutput!(input, raw)
      expect(result.ok).toBe(true)
      if (result.ok)
        expect(result.output.dueDate).toBe(text.includes('2025') ? '2025-09-17' : '2026-09-17')
    }
  })
  it('quotes full-name person selectors and preserves overdue grouping', () => {
    const input = nlAnalyticsSpec.inputSchema.parse({
      locale: 'en',
      today: '2026-10-08',
      query: 'Who has the most overdue tasks? Nodira',
      knownMembers: [{ name: 'Nodira Karimova', handle: 'Nodira Karimova' }],
      dateRange: { since: '2026-10-01', until: '2026-10-08' },
    })
    const output = nlAnalyticsSpec.simulate(input)
    expect(output.metric).toBe('openVsOverdue')
    expect(output.filterText).toContain('assignee:"@Nodira Karimova"')
    expect(nlAnalyticsSpec.validateOutput!(input, output)).toMatchObject({
      ok: true,
      output: { filterText: output.filterText },
    })
  })
  it('uses translation target and byte-preserved tokens instead of reader locale', async () => {
    const config = loadAiConfig({})
    const english = {
      translatedText: "O'Connor's report",
      detectedSourceLocale: 'ru',
      alreadyInTarget: false,
      uncertainTerms: [],
    }
    const provider = new MockProvider({
      respond: (req) => ({
        content: null,
        reasoningContent: null,
        toolCalls: [{ id: 'x', name: req.tools![0]!.name, argumentsJson: JSON.stringify(english) }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    })
    const result = await runFeature<{ translatedText: string }>({
      config,
      provider,
      feature: 'translate',
      input: {
        locale: 'uz-Latn',
        targetLocale: 'en',
        text: "Отчёт O'Connor",
        preserve: ["O'Connor"],
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.translatedText).toBe(english.translatedText)
  })
})

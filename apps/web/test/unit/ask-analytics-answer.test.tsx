import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { NlAnalyticsOutput } from '../../src/features/ai/outputs.js'
import type { AnalyticsSummary } from '../../src/features/analytics/types.js'

const state = vi.hoisted(() => ({ output: null as NlAnalyticsOutput | null }))
vi.mock('../../src/lib/session.js', () => ({
  useMeQuery: () => ({
    data: {
      user: { id: 'head-a' },
      activeDepartmentId: 'department-a',
      actingForUserId: null,
    },
  }),
}))
vi.mock('../../src/features/ai/use-ai.js', () => ({
  useRunAiFeatureMutation: () => ({
    data: state.output ? { data: state.output } : undefined,
    isPending: false,
    isError: false,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}))
vi.mock('../../src/features/analytics/api.js', () => ({ fetchSummary: vi.fn() }))
vi.mock('../../src/features/ai/components/ai-result-panel.js', () => ({
  AiResultPanel: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  ConfidenceChip: () => null,
}))

import { AskAnalytics } from '../../src/features/analytics/ask-analytics.js'
import { fetchSummary } from '../../src/features/analytics/api.js'

const base: AnalyticsSummary = {
  since: '2026-10-01T00:00:00Z',
  until: '2026-10-08T00:00:00Z',
  throughput: [],
  onTimeRate: { overall: null, series: [] },
  openVsOverdue: [],
  loadPerPerson: [
    { userId: 'unfiltered', name: 'Whole department', openCount: 111, overdueCount: 99 },
  ],
  loadPerUnit: [],
  projectProgress: [],
  eventsParticipation: [],
  pollTurnout: [],
  personal: {
    openCount: 0,
    overdueCount: 0,
    doneThisWeek: 0,
    onTimeRate: null,
    focusMinutesThisWeek: 0,
    upcomingEventCount: 0,
    givenOverdueCount: 0,
  },
}

function showAnswer(output: NlAnalyticsOutput, summary: AnalyticsSummary) {
  state.output = output
  vi.mocked(fetchSummary).mockReset().mockResolvedValue(summary)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={client}>
      <AskAnalytics summary={base} onApplyFilter={vi.fn()} />
    </QueryClientProvider>,
  )
  return {
    close: () => {
      rendered.unmount()
      client.clear()
    },
  }
}

const output: NlAnalyticsOutput = {
  metric: 'openVsOverdue',
  groupBy: 'person',
  chartType: 'table',
  filterText: 'unit:"Data" status:active due:<2026-10-08',
  unmappedTerms: [],
  confidence: 'high',
  restatement: 'Who has the most overdue tasks in Data?',
}

describe('measured AI analytics answer preview', () => {
  it('queries the proposed filter and displays overdue counts from that result rather than open or department totals', async () => {
    const view = showAnswer(output, {
      ...base,
      loadPerPerson: [
        { userId: 'nodira', name: 'Nodira', openCount: 20, overdueCount: 2 },
        { userId: 'anvar', name: 'Anvar', openCount: 10, overdueCount: 4 },
      ],
    })
    await waitFor(() =>
      expect(fetchSummary).toHaveBeenCalledWith({
        filter: output.filterText,
        since: '2026-10-01',
        until: '2026-10-08',
      }),
    )
    expect(await screen.findByText('6')).toBeVisible()
    expect(screen.getByText('2')).toBeVisible()
    expect(screen.getByText('4')).toBeVisible()
    for (const wrong of ['20', '10', '30', '99', '111', 'Whole department'])
      expect(screen.queryByText(wrong)).not.toBeInTheDocument()
    view.close()
  })

  for (const metric of ['projectProgress', 'eventsParticipation', 'pollTurnout'] as const)
    it(`shows ${metric} percentages separately without an invented summed rate`, async () => {
      const view = showAnswer(
        { ...output, metric, groupBy: metric === 'projectProgress' ? 'project' : 'none' },
        {
          ...base,
          projectProgress: [
            {
              id: 'a',
              title: 'Project A',
              status: 'active',
              totalTasks: 20,
              doneTasks: 16,
              progress: 0.8,
            },
            {
              id: 'b',
              title: 'Project B',
              status: 'active',
              totalTasks: 20,
              doneTasks: 9,
              progress: 0.45,
            },
          ],
          eventsParticipation: [
            {
              id: 'a',
              title: 'Event A',
              startsAt: base.until,
              yes: 16,
              no: 4,
              maybe: 0,
              waitlist: 0,
              rsvpRate: 0.8,
            },
            {
              id: 'b',
              title: 'Event B',
              startsAt: base.until,
              yes: 9,
              no: 11,
              maybe: 0,
              waitlist: 0,
              rsvpRate: 0.45,
            },
          ],
          pollTurnout: [
            { id: 'a', question: 'Poll A', status: 'closed', voters: 16, turnoutRate: 0.8 },
            { id: 'b', question: 'Poll B', status: 'closed', voters: 9, turnoutRate: 0.45 },
          ],
        },
      )
      expect(await screen.findByText('80')).toBeVisible()
      expect(screen.getByText('45')).toBeVisible()
      expect(screen.queryByText('125')).not.toBeInTheDocument()
      view.close()
    })
})

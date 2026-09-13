// "Ask analytics" (AI-AUDIT F8). A plain-language question becomes filter-grammar text
// (`@devon/contracts`'s `parseFilterQuery` syntax -- exactly what a person could type into the filter
// bar by hand), previewed and only applied on Accept. This file never runs a query itself: AI output
// is data, never trusted as already-safe (TECH-SPEC §8).
//
// Two v1.1 changes, both from the audit's §0.3 "the features are input-starved":
//
//   * The model is told what actually exists. v1.0 passed `knownUnits` and nothing else, so
//     `label:`, `project:` and `assignee:@…` were unreachable by construction -- the schema had the
//     fields and the caller passed neither. All four are supplied now, from the summary the screen
//     has already loaded.
//   * The preview answers with **numbers**. "Bu oy Data boʻlimining muddati oʻtgan ishlari" should
//     come back as "7", not as a filter string the reader has to apply to find out. The filter is
//     still shown, underneath, because a head who cannot see how a number was reached cannot defend
//     it -- but it is no longer the answer.
import * as React from 'react'
import { useT, useLocale } from '@devon/i18n'
import { Input, SparkleButton } from '@devon/ui'
import { useRunAiFeatureMutation } from '../ai/use-ai.js'
import { AiResultPanel } from '../ai/components/ai-result-panel.js'
import { AnalyticsAnswerPreview } from '../ai/components/previews.js'
import { parseFeatureOutput, type NlAnalyticsOutput } from '../ai/outputs.js'
import { ApiError } from '../../lib/api-client.js'
import type { AnalyticsSummary } from './types.js'

function errorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_failed') return 'analytics.ask.errors.invalid'
    if (err.code === 'forbidden') return 'analytics.ask.errors.forbidden'
  }
  return 'analytics.ask.errors.failed'
}

/**
 * The numbers behind the answer, read off the summary this screen has already fetched -- never a
 * second request, and never a number the model produced.
 *
 * This is the honest half of "answer with the numbers": the model decides *what was asked*, and the
 * department's own aggregates decide *what the answer is*. A model that invents "7 overdue" is one a
 * ministry cannot use; a model that says "you asked for the overdue/open split" and then reads 7 off
 * the real aggregate is one it can.
 *
 * `metric` is a section of `AnalyticsSummary`, not a generic measure -- which is exactly why this is
 * a lookup and not an aggregation. Returns `null` when the question maps to something this summary
 * does not carry, which is a better answer than a fabricated total.
 */
function answerFrom(
  summary: AnalyticsSummary,
  output: NlAnalyticsOutput,
): { rows: { label: string; value: number }[]; total: number } | null {
  const sum = (rows: { value: number }[]): number => rows.reduce((n, row) => n + row.value, 0)
  const nonEmpty = (rows: { label: string; value: number }[]) =>
    rows.length > 0 ? { rows, total: sum(rows) } : null

  switch (output.metric) {
    case 'throughput': {
      const rows = summary.throughput.map((week) => ({
        label: week.weekStart,
        value: week.count,
      }))
      return nonEmpty(rows)
    }
    case 'onTimeRate': {
      const overall = summary.onTimeRate.overall
      if (overall === null) return null
      return { rows: [], total: Math.round(overall * 100) }
    }
    case 'openVsOverdue': {
      // The one metric where `groupBy` genuinely changes the answer: the same open/overdue split,
      // per person, per unit, or as one number for the department.
      if (output.groupBy === 'person') {
        return nonEmpty(
          summary.loadPerPerson.map((person) => ({
            label: person.name,
            value: person.overdueCount,
          })),
        )
      }
      if (output.groupBy === 'unit') {
        return nonEmpty(
          summary.loadPerUnit.map((unit) => ({
            label: unit.unitName ?? '',
            value: unit.overdueCount,
          })),
        )
      }
      const overdue = summary.loadPerPerson.reduce((n, person) => n + person.overdueCount, 0)
      return { rows: [], total: overdue }
    }
    case 'loadPerPerson':
      return nonEmpty(
        summary.loadPerPerson.map((person) => ({ label: person.name, value: person.openCount })),
      )
    case 'loadPerUnit':
      return nonEmpty(
        summary.loadPerUnit.map((unit) => ({ label: unit.unitName ?? '', value: unit.openCount })),
      )
    case 'projectProgress':
      return nonEmpty(
        summary.projectProgress.map((project) => ({
          label: project.title,
          value: Math.round(project.progress * 100),
        })),
      )
    case 'eventsParticipation':
      return nonEmpty(
        summary.eventsParticipation.map((event) => ({
          label: event.title,
          value: Math.round(event.rsvpRate * 100),
        })),
      )
    case 'pollTurnout':
      return nonEmpty(
        summary.pollTurnout.map((poll) => ({
          label: poll.question,
          value: Math.round(poll.turnoutRate * 100),
        })),
      )
    default:
      // No metric: the question mapped to a filter but not to a number this screen holds. The
      // restatement and the filter are still shown -- the preview just does not claim a total.
      return null
  }
}

export function AskAnalytics({
  summary,
  onApplyFilter,
}: {
  summary: AnalyticsSummary
  onApplyFilter: (filterText: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = React.useState('')
  const runMutation = useRunAiFeatureMutation('nl_analytics')
  const knownUnits = React.useMemo(
    () => summary.loadPerUnit.map((u) => u.unitName).filter((n): n is string => Boolean(n)),
    [summary.loadPerUnit],
  )
  const knownProjects = React.useMemo(
    () => summary.projectProgress.map((project) => project.title),
    [summary.projectProgress],
  )
  const knownMembers = React.useMemo(
    () => summary.loadPerPerson.map((person) => ({ name: person.name, handle: '' })),
    [summary.loadPerPerson],
  )

  function ask() {
    const trimmed = query.trim()
    if (!trimmed) return
    runMutation.mutate({
      locale,
      query: trimmed,
      today: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      knownUnits,
      knownLabels: [],
      knownProjects,
      knownMembers,
      dateRange: { since: summary.since.slice(0, 10), until: summary.until.slice(0, 10) },
    })
  }

  const output = runMutation.data
    ? parseFeatureOutput<NlAnalyticsOutput>('nl_analytics', runMutation.data.data)
    : null
  const answer = output ? answerFrom(summary, output) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ask()
            }
          }}
          placeholder={t('analytics.ask.placeholder')}
          aria-label={t('analytics.ask.placeholder')}
          className="min-w-64 flex-1"
        />
        <SparkleButton
          aria-label={t('analytics.ask.action')}
          label={t('analytics.ask.action')}
          size="sm"
          loading={runMutation.isPending}
          disabled={!query.trim()}
          onClick={ask}
        />
      </div>

      {runMutation.isPending || runMutation.isError || runMutation.data ? (
        <AiResultPanel
          title={t('analytics.ask.title')}
          status={runMutation.isPending ? 'pending' : runMutation.isError ? 'error' : 'ready'}
          {...(runMutation.error ? { errorMessage: t(errorKey(runMutation.error)) } : {})}
          {...(runMutation.data ? { meta: runMutation.data.meta } : {})}
          acceptLabel={t('analytics.ask.apply')}
          editLabel={t('analytics.ask.edit')}
          onRetry={ask}
          onAccept={() => {
            if (output) onApplyFilter(output.filterText)
            runMutation.reset()
            setQuery('')
          }}
          // Edit puts the filter grammar into the question box, so the person can adjust the filter
          // itself rather than re-asking in prose. v1.0's Edit just reset the mutation, which is
          // what Discard already did.
          onEdit={() => {
            if (output) setQuery(output.filterText)
            runMutation.reset()
          }}
          onDiscard={() => {
            runMutation.reset()
            setQuery('')
          }}
        >
          {output ? (
            <AnalyticsAnswerPreview
              output={output}
              {...(answer ? { rows: answer.rows, total: answer.total } : {})}
            />
          ) : null}
        </AiResultPanel>
      ) : null}
    </div>
  )
}

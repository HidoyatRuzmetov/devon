// `/analytics` (TECH-SPEC §9, EPIC-010): the filter bar plus every section, in the order TECH-SPEC
// lists them. URL-as-state for the filter (design.md §8's convention, same as work's board filters)
// so a link to a specific view is shareable and survives a reload.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { PageHeader, StateView } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import { useSearchParams, navigate } from '../../lib/router.js'
import {
  EventsParticipationSection,
  KpiOverviewRow,
  LoadPerPersonSection,
  LoadPerUnitSection,
  OnTimeRateSection,
  OpenVsOverdueSection,
  PersonalStatsSection,
  PollTurnoutSection,
  ProjectProgressSection,
  ThroughputSection,
} from './sections.js'
import { AskAnalytics } from './ask-analytics.js'
import { FilterBar, type FilterBarValue } from './filter-bar.js'
import {
  usePinChartMutation,
  usePinnedChartsQuery,
  useSummaryQuery,
  useUnpinChartMutation,
} from './use-analytics.js'

function defaultRange(): { since: string; until: string } {
  const until = new Date()
  const since = new Date(until.getTime() - 84 * 24 * 60 * 60_000) // 12 weeks
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }
}

export default function AnalyticsScreen() {
  const t = useT()
  const meQuery = useMeQuery()
  const search = useSearchParams()
  const fallback = React.useMemo(defaultRange, [])

  const value: FilterBarValue = {
    filter: search.get('filter') ?? '',
    since: search.get('since') ?? fallback.since,
    until: search.get('until') ?? fallback.until,
  }

  const setValue = (next: FilterBarValue) => {
    const url = new URL(window.location.href)
    if (next.filter) url.searchParams.set('filter', next.filter)
    else url.searchParams.delete('filter')
    url.searchParams.set('since', next.since)
    url.searchParams.set('until', next.until)
    navigate(`${url.pathname}${url.search}`, { replace: true })
  }

  const summaryQuery = useSummaryQuery(value)
  const pinnedQuery = usePinnedChartsQuery()
  const pinChart = usePinChartMutation()
  const unpinChart = useUnpinChartMutation()

  const pinnedByKey = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const p of pinnedQuery.data ?? []) map.set(p.chartKey, p.id)
    return map
  }, [pinnedQuery.data])
  const pinnedKeys = React.useMemo(() => new Set(pinnedByKey.keys()), [pinnedByKey])

  const handleTogglePin = (chartKey: string, title: string) => {
    const existingId = pinnedByKey.get(chartKey)
    if (existingId) unpinChart.mutate(existingId)
    else pinChart.mutate({ chartKey: chartKey as never, title, filterQuery: value.filter })
  }

  if (meQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (!meQuery.data) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }

  if (summaryQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (summaryQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => summaryQuery.refetch() }}
      />
    )
  }

  const summary = summaryQuery.data
  const isEmpty =
    summary.throughput.every((p) => p.count === 0) &&
    summary.loadPerPerson.every((p) => p.openCount === 0) &&
    summary.projectProgress.length === 0 &&
    summary.eventsParticipation.length === 0 &&
    summary.pollTurnout.length === 0

  const sectionProps = {
    summary,
    query: value,
    pinnedKeys,
    onTogglePin: handleTogglePin,
    pinBusy: pinChart.isPending || unpinChart.isPending,
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t('analytics.eyebrow')} title={t('analytics.title')} />
      <FilterBar value={value} onChange={setValue} />
      <AskAnalytics summary={summary} onApplyFilter={(filter) => setValue({ ...value, filter })} />

      {isEmpty ? (
        <StateView kind="empty" titleKey="analytics.empty.title" bodyKey="analytics.empty.body" />
      ) : (
        <>
          <KpiOverviewRow summary={summary} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ThroughputSection {...sectionProps} />
            <OnTimeRateSection {...sectionProps} />
            <OpenVsOverdueSection {...sectionProps} />
            <LoadPerPersonSection {...sectionProps} />
            <LoadPerUnitSection {...sectionProps} />
            <ProjectProgressSection {...sectionProps} />
            <EventsParticipationSection {...sectionProps} />
            <PollTurnoutSection {...sectionProps} />
            <PersonalStatsSection {...sectionProps} />
          </div>
        </>
      )}
    </div>
  )
}

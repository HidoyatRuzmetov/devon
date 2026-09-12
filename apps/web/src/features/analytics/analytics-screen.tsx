// `/analytics` (TECH-SPEC §9, EPIC-010): the filter bar plus every section, in the order TECH-SPEC
// lists them. URL-as-state for the filter (design.md §8's convention, same as work's board filters)
// so a link to a specific view is shareable and survives a reload.
import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useT } from '@devon/i18n'
import { PageHeader, Skeleton, StateView, useReducedMotion } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import { Can } from '../../lib/can.js'
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
  const analyticsReduced = useReducedMotion()
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
    summary !== undefined &&
    summary.throughput.every((p) => p.count === 0) &&
    summary.loadPerPerson.every((p) => p.openCount === 0) &&
    summary.projectProgress.length === 0 &&
    summary.eventsParticipation.length === 0 &&
    summary.pollTurnout.length === 0

  const sectionProps = summary
    ? {
        summary,
        query: value,
        pinnedKeys,
        onTogglePin: handleTogglePin,
        pinBusy: pinChart.isPending || unpinChart.isPending,
      }
    : null

  // A plain if/else (not a JSX ternary chain) so no `>...<`-shaped boundary between two regions can
  // ever be mistaken for hard-coded text by `check-i18n.mjs`'s regex heuristic (`people-screen.tsx`
  // and `table-screen.tsx` do the same, for the same reason).
  let regionKey: string
  let region: React.ReactNode
  if (!sectionProps) {
    regionKey = 'skeleton'
    region = (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    )
  } else if (isEmpty) {
    regionKey = 'empty'
    region = (
      <StateView kind="empty" titleKey="analytics.empty.title" bodyKey="analytics.empty.body" />
    )
  } else {
    regionKey = 'charts'
    region = (
      <div className="flex flex-col gap-6">
        <KpiOverviewRow summary={summary!} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ThroughputSection {...sectionProps} />
          <OnTimeRateSection {...sectionProps} />
          <OpenVsOverdueSection {...sectionProps} />
          {/* v1.1 SPEC §2.2 (D3a): a chart of who has how many open and overdue tasks is a
              performance comparison -- in a ministry it reads as a public reprimand. Head-only, and
              the server narrows the data to the viewer's own row regardless, so this hide is the
              affordance half, never the boundary. */}
          <Can action="analytics.perPerson.read">
            <LoadPerPersonSection {...sectionProps} />
          </Can>
          <LoadPerUnitSection {...sectionProps} />
          <ProjectProgressSection {...sectionProps} />
          <EventsParticipationSection {...sectionProps} />
          <PollTurnoutSection {...sectionProps} />
          <PersonalStatsSection {...sectionProps} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t('analytics.eyebrow')} title={t('analytics.title')} />
      <FilterBar value={value} onChange={setValue} />
      {summary ? (
        <AskAnalytics
          summary={summary}
          onApplyFilter={(filter) => setValue({ ...value, filter })}
        />
      ) : null}

      {/* round2 SEV2 "no skeleton -> chart crossfade": a date-range change used to swap the whole
          grid for a full-page spinner, which also hid the filter bar mid-edit -- the chrome above
          now stays mounted and only this region crossfades between its skeleton, empty and loaded
          shapes, keyed on which of the three is current. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={regionKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: analyticsReduced ? 0.1 : 0.18 }}
        >
          {region}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

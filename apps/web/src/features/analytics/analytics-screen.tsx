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

  const filterParam = search.get('filter') ?? ''
  const sinceParam = search.get('since') ?? fallback.since
  const untilParam = search.get('until') ?? fallback.until
  // One identity per actual range/filter, not one per render -- `useSummaryQuery`'s key, the memoised
  // section props below and the `React.memo`'d sections all hang off this.
  const value: FilterBarValue = React.useMemo(
    () => ({ filter: filterParam, since: sinceParam, until: untilParam }),
    [filterParam, sinceParam, untilParam],
  )

  // Motion verdict F7: `Oxirgi 7 kun -> Oxirgi 90 kun` blocked the main thread for 838 ms, so the
  // skeleton it swaps to never painted and the screen simply jumped to its new end state. The range
  // change is a transition: React keeps the charts that are already on screen painted and interactive
  // while it prepares the skeleton render in slices, so the crossfade below gets its frames.
  const setValue = React.useCallback((next: FilterBarValue) => {
    const url = new URL(window.location.href)
    if (next.filter) url.searchParams.set('filter', next.filter)
    else url.searchParams.delete('filter')
    url.searchParams.set('since', next.since)
    url.searchParams.set('until', next.until)
    React.startTransition(() => {
      navigate(`${url.pathname}${url.search}`, { replace: true })
    })
  }, [])

  const hasDepartment = Boolean(
    meQuery.data?.activeDepartmentId ?? meQuery.data?.memberships[0]?.departmentId,
  )
  const summaryQuery = useSummaryQuery(value, hasDepartment)
  const pinnedQuery = usePinnedChartsQuery(hasDepartment)
  const pinChart = usePinChartMutation()
  const unpinChart = useUnpinChartMutation()

  const pinnedByKey = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const p of pinnedQuery.data ?? []) map.set(p.chartKey, p.id)
    return map
  }, [pinnedQuery.data])
  const pinnedKeys = React.useMemo(() => new Set(pinnedByKey.keys()), [pinnedByKey])

  // Stable, so the memoised sections below are not re-rendered by a new closure every render.
  const handleTogglePin = React.useCallback(
    (chartKey: string, title: string) => {
      const existingId = pinnedByKey.get(chartKey)
      if (existingId) unpinChart.mutate(existingId)
      else pinChart.mutate({ chartKey: chartKey as never, title, filterQuery: value.filter })
    },
    [pinnedByKey, unpinChart, pinChart, value.filter],
  )

  // One object identity per meaningful change, so `React.memo` on the nine sections actually holds
  // (motion verdict F7). Declared above the early returns below, because a hook may not be called
  // conditionally.
  const pinBusy = pinChart.isPending || unpinChart.isPending
  const summaryData = summaryQuery.data
  const memoSectionProps = React.useMemo(
    () =>
      summaryData
        ? {
            summary: summaryData,
            query: value,
            pinnedKeys,
            onTogglePin: handleTogglePin,
            pinBusy,
          }
        : null,
    [summaryData, value, pinnedKeys, handleTogglePin, pinBusy],
  )

  if (meQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (!meQuery.data) {
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  }
  if (!hasDepartment) {
    const admin = meQuery.data.user.role === 'super_admin'
    return (
      <StateView
        kind="empty"
        titleKey="analytics.context.title"
        bodyKey={admin ? 'analytics.context.adminBody' : 'analytics.context.memberBody'}
        action={{
          labelKey: admin ? 'analytics.context.globalAction' : 'analytics.context.homeAction',
          onAction: () => navigate(admin ? '/admin/analytics' : '/'),
        }}
      />
    )
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

  const sectionProps = memoSectionProps

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
    // Keyed on the range too, not just on "charts" (motion verdict F7). With the range change now
    // running inside `React.startTransition`, React holds the charts that are already painted and
    // skips the intermediate skeleton entirely -- which is the right behaviour for a list that is
    // being refiltered, but it meant DESIGN.md §10's crossfade for this moment played on nothing at
    // all. Re-keying on the range gives `AnimatePresence mode="wait"` a real old/new pair, so the
    // previous charts fade out and the new ones fade in instead of the numbers simply being
    // different.
    regionKey = `charts:${value.since}:${value.until}:${value.filter}`
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

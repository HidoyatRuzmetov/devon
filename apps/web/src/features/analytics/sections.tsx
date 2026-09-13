// One chart section per TECH-SPEC §9 line item, each a thin Recharts wrapper inside `ChartCard`
// (owner question, export, pin, animated draw-in, accessible table fallback). Colours are CSS
// variables from `packages/ui`'s tokens (`var(--color-*)`), never a raw hex -- Recharts accepts any
// valid CSS colour string for `stroke`/`fill`.
import * as React from 'react'
import { useT, useLocale, formatDate, formatNumber } from '@devon/i18n'
import { KpiTile } from '@devon/ui'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartCard, useChartAnimation } from './chart-card.js'
import { exportCsvUrl } from './api.js'
import type {
  AnalyticsSummary,
  EventParticipation,
  OnTimePoint,
  OpenOverduePoint,
  PersonLoad,
  PollTurnout,
  ProjectProgress,
  UnitLoad,
  WeekPoint,
} from './types.js'

const COLOR_PRIMARY = 'var(--color-primary)'
const COLOR_SUCCESS = 'var(--color-success)'
const COLOR_WARNING = 'var(--color-warning)'
const COLOR_DESTRUCTIVE = 'var(--color-destructive)'
const COLOR_INFO = 'var(--color-info)'
const COLOR_MUTED = 'var(--color-muted-foreground)'
const COLOR_BORDER = 'var(--color-border)'

export type SectionProps = {
  summary: AnalyticsSummary
  query: { filter?: string; since?: string; until?: string }
  pinnedKeys: Set<string>
  onTogglePin: (chartKey: string, title: string) => void
  pinBusy: boolean
}

function useWeekLabel() {
  const locale = useLocale()
  return React.useCallback(
    (weekStart: string) => formatDate(new Date(`${weekStart}T00:00:00Z`), locale),
    [locale],
  )
}

const tooltipStyle: React.CSSProperties = {
  background: 'var(--color-card)',
  border: `1px solid ${COLOR_BORDER}`,
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--color-foreground)',
}

// DESIGN.md's "chart cards ... hover crosshair tooltips": a dashed guide the eye can follow (a line
// on a time series) or a soft highlight on the hovered row/column (a bar), instead of Recharts'
// default flat grey rectangle -- both drawn from tokens so they hold up in both themes.
const lineCursor = { stroke: COLOR_PRIMARY, strokeWidth: 1, strokeDasharray: '4 4' }
const barCursor = { fill: 'var(--color-accent)' }

/** Week-over-week percent change, from real points already in the summary payload -- never a made-up
 * comparison. `null` (not `0`) when there is no previous week to compare against, so `KpiTile` shows
 * no arrow rather than a misleading flat one. */
function weekOverWeekPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return Math.round(((curr - prev) / prev) * 100)
}

function onTimePercent(p: OnTimePoint | undefined): number | null {
  if (!p || p.dueCount === 0) return null
  return Math.round((p.onTimeCount / p.dueCount) * 100)
}

/** UI-OVERHAUL.md §2 "Analytics ... KPI tiles with NumberFlow and delta arrows": the department-wide
 * headline row above every chart section, each tile answering one question and showing the same
 * week-over-week trend a head would otherwise have to read off the throughput/open-vs-overdue charts
 * themselves. */
export function KpiOverviewRow({ summary }: { summary: AnalyticsSummary }) {
  const t = useT()
  const locale = useLocale()
  const tp = summary.throughput
  const throughputLast = tp.length > 0 ? tp[tp.length - 1]!.count : 0
  const throughputDelta =
    tp.length > 1 ? weekOverWeekPct(throughputLast, tp[tp.length - 2]!.count) : null

  const ov = summary.openVsOverdue
  const openLast = ov.length > 0 ? ov[ov.length - 1]!.openCount : 0
  const openDelta = ov.length > 1 ? weekOverWeekPct(openLast, ov[ov.length - 2]!.openCount) : null
  const overdueLast = ov.length > 0 ? ov[ov.length - 1]!.overdueCount : 0
  const overdueDelta =
    ov.length > 1 ? weekOverWeekPct(overdueLast, ov[ov.length - 2]!.overdueCount) : null

  const rateSeries = summary.onTimeRate.series
  const rateLast = onTimePercent(rateSeries[rateSeries.length - 1])
  const ratePrev = onTimePercent(rateSeries[rateSeries.length - 2])
  const rateDelta = rateLast !== null && ratePrev !== null ? rateLast - ratePrev : null
  const lastWeekPoint = rateSeries[rateSeries.length - 1]
  const lastWeekDue = lastWeekPoint ? lastWeekPoint.dueCount : null
  const lastWeekOnTime = lastWeekPoint ? lastWeekPoint.onTimeCount : null

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KpiTile
        label={t('analytics.kpi.throughput')}
        value={throughputLast}
        locale={locale}
        delta={throughputDelta}
        question={t('analytics.kpi.throughputQuestion')}
      />
      <KpiTile
        label={t('analytics.kpi.open')}
        value={openLast}
        locale={locale}
        delta={openDelta}
        deltaGoodWhen="down"
        question={t('analytics.kpi.openQuestion')}
      />
      <KpiTile
        label={t('analytics.kpi.overdue')}
        value={overdueLast}
        locale={locale}
        delta={overdueDelta}
        deltaGoodWhen="down"
        question={t('analytics.kpi.overdueQuestion')}
      />
      {/* WALKTHROUGH-FINDINGS 4.1: three different on-time percentages sat on one screen -- 0 %
          here, 67 % in the chart subtitle, 100 % in the personal tile -- with nothing saying they
          were three different questions. They are: this tile is the LAST WEEK, over the cards that
          came due in it; the chart's subtitle is the whole selected range; the personal tile is
          just the viewer's own work. Each now says its denominator out loud, so the reader can see
          that the numbers agree rather than assuming the product cannot count. */}
      <KpiTile
        label={t('analytics.kpi.onTimeRate')}
        value={rateLast}
        locale={locale}
        suffix="%"
        delta={rateDelta}
        question={
          lastWeekDue === null
            ? t('analytics.kpi.onTimeRateQuestion')
            : t('analytics.kpi.onTimeRateDenominator', {
                onTime: lastWeekOnTime ?? 0,
                due: lastWeekDue,
              })
        }
      />
    </div>
  )
}

const ThroughputSectionImpl = function ThroughputSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const locale = useLocale()
  const animate = useChartAnimation()
  const weekLabel = useWeekLabel()
  // Motion verdict F7: the chart's own rows are derived once per summary, not once per parent
  // render, so a KPI state settle (or a pin toggle) cannot re-run fourteen of these.
  const data = React.useMemo(
    () => summary.throughput.map((p: WeekPoint) => ({ ...p, label: weekLabel(p.weekStart) })),
    [summary.throughput, weekLabel],
  )

  return (
    <ChartCard
      chartKey="throughput"
      titleKey="analytics.sections.throughput.title"
      questionKey="analytics.sections.throughput.question"
      csvHref={exportCsvUrl('throughput', query)}
      pinned={pinnedKeys.has('throughput')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('throughput', t('analytics.sections.throughput.title'))}
      table={{
        headers: [t('analytics.filterBar.since'), t('analytics.legend.done')],
        rows: data.map((p) => [p.label, p.count]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.throughput.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_MUTED }} tickLine={false} />
          <YAxis
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={barCursor}
            labelStyle={{ color: 'var(--color-foreground)' }}
            formatter={(v) => (typeof v === 'number' ? formatNumber(v, locale) : String(v ?? ''))}
          />
          <Bar
            dataKey="count"
            name={t('analytics.legend.done')}
            fill={COLOR_PRIMARY}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const OnTimeRateSectionImpl = function OnTimeRateSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const animate = useChartAnimation()
  const weekLabel = useWeekLabel()
  const data = React.useMemo(
    () =>
      summary.onTimeRate.series.map((p: OnTimePoint) => ({
        ...p,
        label: weekLabel(p.weekStart),
        rate: p.dueCount > 0 ? Math.round((p.onTimeCount / p.dueCount) * 100) : null,
      })),
    [summary.onTimeRate.series, weekLabel],
  )
  const overallPercent =
    summary.onTimeRate.overall === null ? null : Math.round(summary.onTimeRate.overall * 100)
  // The subtitle's own denominator, summed from the very series the chart draws -- so the sentence
  // and the line can never disagree.
  const totalDue = summary.onTimeRate.series.reduce((n, p) => n + p.dueCount, 0)
  const totalOnTime = summary.onTimeRate.series.reduce((n, p) => n + p.onTimeCount, 0)

  return (
    <ChartCard
      chartKey="onTimeRate"
      titleKey="analytics.sections.onTimeRate.title"
      questionKey="analytics.sections.onTimeRate.question"
      csvHref={exportCsvUrl('onTimeRate', query)}
      pinned={pinnedKeys.has('onTimeRate')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('onTimeRate', t('analytics.sections.onTimeRate.title'))}
      table={{
        headers: [t('analytics.filterBar.since'), '%'],
        rows: data.map((p) => [p.label, p.rate ?? '-']),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.onTimeRate.empty"
    >
      {overallPercent !== null ? (
        <p className="mb-2 text-lead text-foreground">
          {t('analytics.sections.onTimeRate.overall', { percent: overallPercent })}{' '}
          <span className="text-small text-muted-foreground">
            {t('analytics.sections.onTimeRate.overallDenominator', {
              onTime: totalOnTime,
              due: totalDue,
            })}
          </span>
        </p>
      ) : null}
      <ResponsiveContainer width="100%" height="100%" minHeight={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_MUTED }} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={lineCursor} formatter={(v) => `${v}%`} />
          <Line
            type="monotone"
            dataKey="rate"
            name="%"
            stroke={COLOR_SUCCESS}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={animate}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const OpenVsOverdueSectionImpl = function OpenVsOverdueSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const locale = useLocale()
  const animate = useChartAnimation()
  const weekLabel = useWeekLabel()
  const data = React.useMemo(
    () =>
      summary.openVsOverdue.map((p: OpenOverduePoint) => ({
        ...p,
        label: weekLabel(p.weekStart),
      })),
    [summary.openVsOverdue, weekLabel],
  )

  return (
    <ChartCard
      chartKey="openVsOverdue"
      titleKey="analytics.sections.openVsOverdue.title"
      questionKey="analytics.sections.openVsOverdue.question"
      csvHref={exportCsvUrl('openVsOverdue', query)}
      pinned={pinnedKeys.has('openVsOverdue')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('openVsOverdue', t('analytics.sections.openVsOverdue.title'))}
      legend={[
        { label: t('analytics.legend.open'), colorVar: COLOR_INFO },
        { label: t('analytics.legend.overdue'), colorVar: COLOR_DESTRUCTIVE },
      ]}
      table={{
        headers: [
          t('analytics.filterBar.since'),
          t('analytics.legend.open'),
          t('analytics.legend.overdue'),
        ],
        rows: data.map((p) => [p.label, p.openCount, p.overdueCount]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.openVsOverdue.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_MUTED }} tickLine={false} />
          <YAxis
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={lineCursor}
            formatter={(v) => (typeof v === 'number' ? formatNumber(v, locale) : String(v ?? ''))}
          />
          <Line
            type="monotone"
            dataKey="openCount"
            name={t('analytics.legend.open')}
            stroke={COLOR_INFO}
            strokeWidth={2}
            dot={false}
            isAnimationActive={animate}
          />
          <Line
            type="monotone"
            dataKey="overdueCount"
            name={t('analytics.legend.overdue')}
            stroke={COLOR_DESTRUCTIVE}
            strokeWidth={2}
            dot={false}
            isAnimationActive={animate}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const LoadPerPersonSectionImpl = function LoadPerPersonSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const locale = useLocale()
  const animate = useChartAnimation()
  const data = React.useMemo(
    () =>
      [...summary.loadPerPerson]
        .sort((a: PersonLoad, b: PersonLoad) => b.openCount - a.openCount)
        .slice(0, 12),
    [summary.loadPerPerson],
  )

  return (
    <ChartCard
      chartKey="loadPerPerson"
      titleKey="analytics.sections.loadPerPerson.title"
      questionKey="analytics.sections.loadPerPerson.question"
      csvHref={exportCsvUrl('loadPerPerson', query)}
      pinned={pinnedKeys.has('loadPerPerson')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('loadPerPerson', t('analytics.sections.loadPerPerson.title'))}
      legend={[
        { label: t('analytics.legend.open'), colorVar: COLOR_PRIMARY },
        { label: t('analytics.legend.overdue'), colorVar: COLOR_DESTRUCTIVE },
      ]}
      table={{
        headers: [
          t('analytics.filterBar.since'),
          t('analytics.legend.open'),
          t('analytics.legend.overdue'),
        ].slice(1),
        rows: summary.loadPerPerson.map((p) => [p.name, p.openCount, p.overdueCount]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.loadPerPerson.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(200, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={barCursor}
            formatter={(v) => (typeof v === 'number' ? formatNumber(v, locale) : String(v ?? ''))}
          />
          <Bar
            dataKey="openCount"
            name={t('analytics.legend.open')}
            fill={COLOR_PRIMARY}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          />
          <Bar
            dataKey="overdueCount"
            name={t('analytics.legend.overdue')}
            fill={COLOR_DESTRUCTIVE}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const LoadPerUnitSectionImpl = function LoadPerUnitSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const locale = useLocale()
  const animate = useChartAnimation()
  const data = React.useMemo(
    () =>
      summary.loadPerUnit.map((u: UnitLoad) => ({
        ...u,
        name: u.unitName ?? t('analytics.legend.unassigned'),
      })),
    [summary.loadPerUnit, t],
  )

  return (
    <ChartCard
      chartKey="loadPerUnit"
      titleKey="analytics.sections.loadPerUnit.title"
      questionKey="analytics.sections.loadPerUnit.question"
      csvHref={exportCsvUrl('loadPerUnit', query)}
      pinned={pinnedKeys.has('loadPerUnit')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('loadPerUnit', t('analytics.sections.loadPerUnit.title'))}
      legend={[
        { label: t('analytics.legend.open'), colorVar: COLOR_PRIMARY },
        { label: t('analytics.legend.overdue'), colorVar: COLOR_DESTRUCTIVE },
      ]}
      table={{
        headers: ['', t('analytics.legend.open'), t('analytics.legend.overdue')],
        rows: data.map((u) => [u.name, u.openCount, u.overdueCount]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.loadPerUnit.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(180, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={barCursor}
            formatter={(v) => (typeof v === 'number' ? formatNumber(v, locale) : String(v ?? ''))}
          />
          <Bar
            dataKey="openCount"
            name={t('analytics.legend.open')}
            fill={COLOR_PRIMARY}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          />
          <Bar
            dataKey="overdueCount"
            name={t('analytics.legend.overdue')}
            fill={COLOR_DESTRUCTIVE}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const ProjectProgressSectionImpl = function ProjectProgressSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const animate = useChartAnimation()
  const data = React.useMemo(
    () =>
      summary.projectProgress.map((p: ProjectProgress) => ({
        ...p,
        percent: Math.round(p.progress * 100),
      })),
    [summary.projectProgress],
  )

  return (
    <ChartCard
      chartKey="projectProgress"
      titleKey="analytics.sections.projectProgress.title"
      questionKey="analytics.sections.projectProgress.question"
      csvHref={exportCsvUrl('projectProgress', query)}
      pinned={pinnedKeys.has('projectProgress')}
      pinBusy={pinBusy}
      onTogglePin={() =>
        onTogglePin('projectProgress', t('analytics.sections.projectProgress.title'))
      }
      table={{
        headers: ['', '%'],
        rows: data.map((p) => [p.title, p.percent]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.projectProgress.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(180, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="title"
            width={140}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={barCursor} formatter={(v) => `${v}%`} />
          <Bar
            dataKey="percent"
            fill={COLOR_INFO}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          >
            {/* round2 SEV3 #28: a 0-100 domain makes a low percentage an invisible sliver near the
                axis -- a value label just outside the bar's own end reads regardless of its length. */}
            <LabelList
              dataKey="percent"
              position="right"
              formatter={(v) => `${typeof v === 'number' ? v : ''}%`}
              fontSize={11}
              fill={COLOR_MUTED}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const EventsParticipationSectionImpl = function EventsParticipationSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const locale = useLocale()
  const animate = useChartAnimation()
  const data = summary.eventsParticipation

  return (
    <ChartCard
      chartKey="eventsParticipation"
      titleKey="analytics.sections.eventsParticipation.title"
      questionKey="analytics.sections.eventsParticipation.question"
      csvHref={exportCsvUrl('eventsParticipation', query)}
      pinned={pinnedKeys.has('eventsParticipation')}
      pinBusy={pinBusy}
      onTogglePin={() =>
        onTogglePin('eventsParticipation', t('analytics.sections.eventsParticipation.title'))
      }
      legend={[
        { label: t('analytics.legend.yes'), colorVar: COLOR_PRIMARY },
        { label: t('analytics.legend.maybe'), colorVar: COLOR_WARNING },
        { label: t('analytics.legend.waitlist'), colorVar: COLOR_INFO },
        { label: t('analytics.legend.no'), colorVar: COLOR_MUTED },
      ]}
      table={{
        headers: [
          '',
          t('analytics.legend.yes'),
          t('analytics.legend.no'),
          t('analytics.legend.maybe'),
          t('analytics.legend.waitlist'),
        ],
        rows: data.map((e: EventParticipation) => [e.title, e.yes, e.no, e.maybe, e.waitlist]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.eventsParticipation.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(180, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="title"
            width={140}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={barCursor}
            formatter={(v) => (typeof v === 'number' ? formatNumber(v, locale) : String(v ?? ''))}
          />
          <Bar
            // DESIGN.md §2.1: green stays strictly the meaning of success/done/approved -- an RSVP
            // headcount is a category in a stacked breakdown, not an accomplishment, so it uses the
            // primary token like every other "how many" series rather than borrowing green's meaning.
            dataKey="yes"
            name={t('analytics.legend.yes')}
            stackId="rsvp"
            fill={COLOR_PRIMARY}
            isAnimationActive={animate}
          />
          <Bar
            dataKey="maybe"
            name={t('analytics.legend.maybe')}
            stackId="rsvp"
            fill={COLOR_WARNING}
            isAnimationActive={animate}
          />
          <Bar
            dataKey="waitlist"
            name={t('analytics.legend.waitlist')}
            stackId="rsvp"
            fill={COLOR_INFO}
            isAnimationActive={animate}
          />
          <Bar
            dataKey="no"
            name={t('analytics.legend.no')}
            stackId="rsvp"
            fill={COLOR_MUTED}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const PollTurnoutSectionImpl = function PollTurnoutSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const animate = useChartAnimation()
  const data = React.useMemo(
    () =>
      summary.pollTurnout.map((p: PollTurnout) => ({
        ...p,
        percent: Math.round(p.turnoutRate * 100),
      })),
    [summary.pollTurnout],
  )

  return (
    <ChartCard
      chartKey="pollTurnout"
      titleKey="analytics.sections.pollTurnout.title"
      questionKey="analytics.sections.pollTurnout.question"
      csvHref={exportCsvUrl('pollTurnout', query)}
      pinned={pinnedKeys.has('pollTurnout')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('pollTurnout', t('analytics.sections.pollTurnout.title'))}
      table={{
        headers: ['', '%'],
        rows: data.map((p) => [p.question, p.percent]),
      }}
      isEmpty={data.length === 0}
      emptyLabelKey="analytics.sections.pollTurnout.empty"
    >
      <ResponsiveContainer width="100%" height="100%" minHeight={Math.max(180, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="question"
            width={160}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={barCursor} formatter={(v) => `${v}%`} />
          <Bar
            dataKey="percent"
            fill={COLOR_INFO}
            radius={[0, 4, 4, 0]}
            isAnimationActive={animate}
          >
            {/* round2 SEV3 #28: "Soʻrovnomalarda qatnashish" is a 3% sliver on a 0-100% axis with
                nothing else to read -- a value label just outside the bar makes the number legible no
                matter how short the bar is. */}
            <LabelList
              dataKey="percent"
              position="right"
              formatter={(v) => `${typeof v === 'number' ? v : ''}%`}
              fontSize={11}
              fill={COLOR_MUTED}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

const PersonalStatsSectionImpl = function PersonalStatsSection({
  summary,
  query,
  pinnedKeys,
  onTogglePin,
  pinBusy,
}: SectionProps) {
  const t = useT()
  const locale = useLocale()
  const p = summary.personal
  const onTimePercent = p.onTimeRate === null ? null : Math.round(p.onTimeRate * 100)

  const tiles: { labelKey: string; value: number; suffix?: string }[] = [
    { labelKey: 'analytics.personal.open', value: p.openCount },
    { labelKey: 'analytics.personal.overdue', value: p.overdueCount },
    { labelKey: 'analytics.personal.doneThisWeek', value: p.doneThisWeek },
    // Renamed from the bare "Oʻz vaqtida bajarilish" (WALKTHROUGH-FINDINGS 4.2): sitting next to
    // "13 ta ochiq, 4 tasi muddatidan oʻtgan", an unqualified 100 % read as a contradiction. It is
    // the on-time share of what this person has *finished*, and now says so.
    ...(onTimePercent !== null
      ? [{ labelKey: 'analytics.personal.onTimeRate', value: onTimePercent, suffix: '%' }]
      : []),
    { labelKey: 'analytics.personal.focusMinutes', value: p.focusMinutesThisWeek },
    { labelKey: 'analytics.personal.upcomingEvents', value: p.upcomingEventCount },
  ]

  return (
    <ChartCard
      chartKey="personal"
      titleKey="analytics.sections.personal.title"
      questionKey="analytics.sections.personal.question"
      csvHref={exportCsvUrl('personal', query)}
      pinned={pinnedKeys.has('personal')}
      pinBusy={pinBusy}
      onTogglePin={() => onTogglePin('personal', t('analytics.sections.personal.title'))}
      table={{
        headers: [t('analytics.sections.personal.title'), ''],
        rows: tiles.map((tile) => [t(tile.labelKey), `${tile.value}${tile.suffix ?? ''}`]),
      }}
    >
      <div className="grid grid-cols-2 gap-4 py-2 sm:grid-cols-3">
        {tiles.map((tile) => (
          <KpiTile
            key={tile.labelKey}
            label={t(tile.labelKey)}
            value={tile.value}
            locale={locale}
            {...(tile.suffix ? { suffix: tile.suffix } : {})}
            className="border-none bg-transparent p-0 shadow-none"
          />
        ))}
      </div>
    </ChartCard>
  )
}

/* Motion verdict F7. Changing the range produced an 838 ms long task: ten `NumberFlow` counters and
 * fourteen Recharts surfaces all re-rendered synchronously, so neither of the catalogue's two
 * animations for this moment -- the skeleton -> chart crossfade and the draw-in replayed on the range
 * key -- ever got a frame. Each section is memoised on the props it is actually given
 * (`analytics-screen.tsx` builds that object in a `useMemo` of its own), so a KPI settling, a pin
 * toggling or the Ask panel answering re-renders one card rather than all fourteen. */
export const ThroughputSection = React.memo(ThroughputSectionImpl)
export const OnTimeRateSection = React.memo(OnTimeRateSectionImpl)
export const OpenVsOverdueSection = React.memo(OpenVsOverdueSectionImpl)
export const LoadPerPersonSection = React.memo(LoadPerPersonSectionImpl)
export const LoadPerUnitSection = React.memo(LoadPerUnitSectionImpl)
export const ProjectProgressSection = React.memo(ProjectProgressSectionImpl)
export const EventsParticipationSection = React.memo(EventsParticipationSectionImpl)
export const PollTurnoutSection = React.memo(PollTurnoutSectionImpl)
export const PersonalStatsSection = React.memo(PersonalStatsSectionImpl)

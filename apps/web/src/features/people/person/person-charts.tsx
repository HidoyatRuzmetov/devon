// The three charts on a person's Umumiy tab (v1.1 SPEC §6): throughput per week, on-time trend, and
// load by project.
//
// Every chart carries a visually-hidden data table of exactly what it draws, the same contract
// `features/analytics/chart-card.tsx` documents: an SVG is not a keyboard target, and a head reading
// this page with a screen reader must get the numbers, not a shrug. Colours are tokens, never hexes,
// so both themes repaint for free.
import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatNumber, useLocale, useT, type Locale } from '@devon/i18n'
import { Card, useReducedMotion } from '@devon/ui'

const COLOR_PRIMARY = 'var(--color-primary)'
const COLOR_SUCCESS = 'var(--color-success)'
const COLOR_DESTRUCTIVE = 'var(--color-destructive)'
const COLOR_MUTED = 'var(--color-muted-foreground)'
const COLOR_BORDER = 'var(--color-border)'

const tooltipStyle: React.CSSProperties = {
  background: 'var(--color-surface-3)',
  border: `1px solid ${COLOR_BORDER}`,
  borderRadius: 'var(--radius-sm)',
  fontSize: 12,
}

function weekLabel(iso: string, locale: Locale): string {
  const date = new Date(iso)
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(date)
}

/**
 * v1.1 critique SEV2 #13 -- "the person page opens on two empty charts ... a head clicking through
 * from 'Kechikayotgan ishlar' lands on what looks like a broken page".
 *
 * The demo dataset carries about four weeks of history against a twelve-week window, so "Haftalik
 * natija" had data in 4 of 12 buckets and "Oʻz vaqtida bajarish" plotted two points at the far right
 * of an otherwise empty axis. Neither chart was wrong; both were unreadable, and an unreadable chart
 * reads as a bug rather than as a young department.
 *
 * A third is the line because that is roughly where a bar chart stops looking like a chart and
 * starts looking like a mistake: four points in twelve is under it, eight in twelve is over it and
 * draws fine. Below the line the chart is replaced by its designed empty state, which says *why* --
 * "reports fill out after twelve weeks" -- rather than leaving the reader to guess.
 */
const MIN_COVERAGE = 1 / 3

function tooSparse(withData: number, total: number): boolean {
  if (total === 0) return true
  return withData / total < MIN_COVERAGE
}

/**
 * SEV2 #13's other half: "its x-axis skips the 08-31 label it has data for".
 *
 * Recharts thins tick labels on its own when it thinks they would collide, and the one it drops is
 * whichever happens to fall in a crowded spot -- which on a 12-point axis in a narrow card was the
 * week the reader was looking for. `interval={0}` keeps every tick; the labels are `dd.MM`, five
 * characters, and there is room for twelve of them.
 */
const AXIS_TICK_PROPS = {
  tick: { fontSize: 11, fill: COLOR_MUTED },
  tickLine: false,
  interval: 0 as const,
  minTickGap: 0,
}

function ChartFrame({
  title,
  question,
  table,
  children,
  empty,
}: {
  title: string
  question: string
  table: { headers: string[]; rows: (string | number)[][] }
  children: React.ReactNode
  empty: string | null
}): React.JSX.Element {
  return (
    <Card elevation="flat" className="flex flex-col gap-2">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-small font-medium">{title}</h3>
        <p className="text-caption text-muted-foreground">{question}</p>
      </header>
      {empty ? (
        <p className="flex min-h-40 items-center justify-center text-caption text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="h-48">{children}</div>
      )}
      <table className="sr-only">
        <tbody>
          <tr>
            {table.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export function ThroughputChart({
  points,
}: {
  points: readonly { week: string; done: number; created: number }[]
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const data = points.map((p) => ({ label: weekLabel(p.week, locale), ...p }))
  const total = data.reduce((sum, p) => sum + p.done, 0)
  // SEV2 #13: a bar chart with four of twelve weeks filled is an empty axis with a few bars stuck to
  // one end. The accessible table below still carries every week, so nothing is hidden -- only the
  // picture is withheld, and it says why.
  //
  // Counted on `done` alone, because `done` is the only series this chart draws: a week where three
  // cards were created and none finished contributes nothing to the picture, and counting it would
  // let a chart with two visible bars call itself well covered.
  const weeksWithData = data.filter((p) => p.done > 0).length
  const sparse = tooSparse(weeksWithData, data.length)
  return (
    <ChartFrame
      title={t('people.person.chart.throughput.title')}
      question={t('people.person.chart.throughput.question')}
      empty={
        total === 0
          ? t('people.person.chart.throughput.empty')
          : sparse
            ? t('people.person.chart.notEnoughData')
            : null
      }
      table={{
        headers: [
          t('people.person.chart.week'),
          t('people.person.chart.done'),
          t('people.person.chart.created'),
        ],
        rows: data.map((p) => [p.label, p.done, p.created]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} vertical={false} />
          <XAxis dataKey="label" {...AXIS_TICK_PROPS} />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-accent)' }} />
          <Bar
            dataKey="done"
            name={t('people.person.chart.done')}
            fill={COLOR_PRIMARY}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reduced}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function OnTimeChart({
  points,
}: {
  points: readonly { week: string; rate: number | null; finished: number }[]
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const data = points.map((p) => ({ label: weekLabel(p.week, locale), ...p }))
  const measured = data.filter((p) => p.rate !== null)
  // SEV2 #13: two points at the far right of an empty axis is not a trend line.
  const sparse = tooSparse(measured.length, data.length)
  return (
    <ChartFrame
      title={t('people.person.chart.onTime.title')}
      question={t('people.person.chart.onTime.question')}
      empty={
        measured.length === 0
          ? t('people.person.chart.onTime.empty')
          : sparse
            ? t('people.person.chart.notEnoughData')
            : null
      }
      table={{
        headers: [
          t('people.person.chart.week'),
          t('people.person.chart.onTimeRate'),
          t('people.person.chart.finished'),
        ],
        rows: data.map((p) => [p.label, p.rate ?? '—', p.finished]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} vertical={false} />
          <XAxis dataKey="label" {...AXIS_TICK_PROPS} />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Line
            type="monotone"
            dataKey="rate"
            name={t('people.person.chart.onTimeRate')}
            stroke={COLOR_SUCCESS}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
            isAnimationActive={!reduced}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export function LoadByProjectChart({
  points,
  noProjectLabel,
}: {
  points: readonly {
    projectId: string | null
    title: string | null
    open: number
    overdue: number
  }[]
  noProjectLabel: string
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const reduced = useReducedMotion()
  const data = points.map((p) => ({
    label: p.title ?? noProjectLabel,
    open: p.open,
    overdue: p.overdue,
  }))
  return (
    <ChartFrame
      title={t('people.person.chart.load.title')}
      question={t('people.person.chart.load.question')}
      empty={data.length === 0 ? t('people.person.chart.load.empty') : null}
      table={{
        headers: [
          t('people.person.chart.project'),
          t('people.person.chart.open'),
          t('people.person.chart.overdue'),
        ],
        rows: data.map((p) => [p.label, p.open, p.overdue]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_BORDER} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
            tickFormatter={(v: number) => formatNumber(v, locale)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={120}
            tick={{ fontSize: 11, fill: COLOR_MUTED }}
            tickLine={false}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-accent)' }} />
          <Bar
            dataKey="open"
            name={t('people.person.chart.open')}
            radius={[0, 4, 4, 0]}
            isAnimationActive={!reduced}
          >
            {data.map((point, index) => (
              <Cell key={index} fill={point.overdue > 0 ? COLOR_DESTRUCTIVE : COLOR_PRIMARY} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

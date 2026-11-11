import { useQuery } from '@tanstack/react-query'
import { formatUzs, useLocale, useT } from '@devon/i18n'
import { Button, Skeleton } from '@devon/ui'
import { Activity } from 'lucide-react'
import * as React from 'react'
import { fetchAdminUsage, fetchAdminUsageHours } from './api.js'
import { UsageNavigator } from './usage-navigator.js'
import { UsagePlot } from './usage-plot.js'
import { departmentColor } from './usage-curves.js'
import {
  addUsage,
  clampDay,
  dayNumber,
  isoDay,
  monthRange,
  overviewPath,
  summarizeUsage,
  usageBuckets,
  zeroUsage,
  type DayRange,
} from './usage-series.js'
import './ai-usage-chart.css'

function Panel({ data }: { data: Awaited<ReturnType<typeof fetchAdminUsage>> }) {
  const t = useT(),
    locale = useLocale()
  const today = dayNumber(data.today),
    thisMonth = data.today.slice(0, 7)
  const firstDay = React.useMemo(
    () => data.days.reduce((earliest, p) => Math.min(earliest, dayNumber(p.day)), today),
    [data.days, today],
  )
  const domain = React.useMemo(
    () => ({ from: monthRange(isoDay(firstDay).slice(0, 7), today).from, to: today }),
    [firstDay, today],
  )
  const [period, setPeriod] = React.useState<'month' | 'all' | 'custom'>('month')
  const [month, setMonth] = React.useState(thisMonth)
  const [custom, setCustom] = React.useState<DayRange>(monthRange(thisMonth, today))
  const [metric, setMetric] = React.useState<'costUzs' | 'tokens'>('costUzs')
  const [selected, setSelected] = React.useState<string | null>(null)
  const range = React.useMemo(
    () =>
      period === 'month'
        ? monthRange(month, today)
        : period === 'all'
          ? { from: firstDay, to: today }
          : custom,
    [period, month, today, firstDay, custom],
  )
  const single = range.from === range.to
  const first = isoDay(range.from),
    last = isoDay(range.to)
  const hourly = useQuery({
    queryKey: ['admin', 'ai-usage', 'hours', first],
    queryFn: () => fetchAdminUsageHours(first),
    enabled: single && data.days.length > 0,
    staleTime: first === data.today ? 30_000 : 300_000,
  })
  const totals = React.useMemo(() => summarizeUsage(data.days, range), [data.days, range])
  const departments = React.useMemo(
    () => data.departments.map((dept, i) => ({ ...dept, colorIndex: i })),
    [data.departments],
  )
  const visible = selected ? departments.filter((dept) => dept.id === selected) : departments
  const total = zeroUsage()
  for (const dept of visible) addUsage(total, totals.get(dept.id) ?? zeroUsage())
  const buckets = React.useMemo(
    () => usageBuckets(data.days, range, single ? hourly.data?.hours : undefined),
    [data.days, range, single, hourly.data],
  )
  const mini = React.useMemo(
    () => overviewPath(data.days, domain, metric, selected),
    [data.days, domain, metric, selected],
  )
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const full = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const monthly = new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const number = new Intl.NumberFormat(locale)
  const date = (day: number) => new Date(day * 86_400_000)
  function changeRange(next: DayRange) {
    setCustom(next)
    setPeriod('custom')
  }
  function exactDate(part: 'from' | 'to', input: string) {
    const value = dayNumber(input)
    if (!Number.isFinite(value)) return
    changeRange(
      part === 'from'
        ? { ...range, from: clampDay(value, domain.from, range.to) }
        : { ...range, to: clampDay(value, range.from, domain.to) },
    )
  }
  return (
    <section
      className="usage-panel"
      data-testid="ai-usage-chart"
      aria-label={t('admin.usage.title')}
    >
      <div className="usage-heading">
        <h2 className="text-h3">{t('admin.usage.title')}</h2>
        <div className="usage-period" role="group" aria-label={t('admin.usage.period')}>
          {(['month', 'all', 'custom'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={value === period}
              onClick={() => {
                if (value === 'custom') setCustom(range)
                setPeriod(value)
              }}
            >
              {t(`admin.usage.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="usage-toolbar">
        <div className="usage-metrics" role="group" aria-label={t('admin.usage.measure')}>
          {(['costUzs', 'tokens'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === metric}
              onClick={() => setMetric(value)}
            >
              <span>{t(`admin.usage.${value}`)}</span>
              <strong>
                {value === 'tokens'
                  ? number.format(total.tokens)
                  : formatUzs(total.costUzs, locale)}
              </strong>
            </button>
          ))}
          <div>
            <span>{t('admin.usage.runs')}</span>
            <strong>{number.format(total.runs)}</strong>
          </div>
        </div>
        <div className="usage-dates">
          {period === 'month' && (
            <input
              type="month"
              aria-label={t('admin.usage.month')}
              value={month}
              min={isoDay(domain.from).slice(0, 7)}
              max={thisMonth}
              onChange={(e) => {
                const value = e.target.value
                if (value && value >= isoDay(domain.from).slice(0, 7) && value <= thisMonth)
                  setMonth(value)
              }}
            />
          )}
          {period === 'custom' && (
            <>
              <input
                type="date"
                aria-label={t('admin.usage.start')}
                min={isoDay(domain.from)}
                max={last}
                value={first}
                onChange={(e) => exactDate('from', e.target.value)}
              />
              <span aria-hidden="true">–</span>
              <input
                type="date"
                aria-label={t('admin.usage.end')}
                min={first}
                max={data.today}
                value={last}
                onChange={(e) => exactDate('to', e.target.value)}
              />
            </>
          )}
          {period === 'all' && <span>{full.formatRange(date(range.from), date(range.to))}</span>}
        </div>
      </div>
      {!data.days.length ? (
        <p className="usage-no-data">{t('admin.usage.empty')}</p>
      ) : (
        <>
          {single && hourly.isPending ? (
            <Skeleton className="mt-5 h-52 w-full" />
          ) : single && hourly.isError ? (
            <Button variant="secondary" onClick={() => void hourly.refetch()}>
              {t('state.error.action')}
            </Button>
          ) : (
            <UsagePlot
              buckets={buckets}
              departments={departments}
              visible={visible}
              metric={metric}
              locale={locale}
              bucketLabel={(b, detail) => {
                if (b.hour !== undefined)
                  return (
                    (detail ? short.format(date(b.from)) + ' · ' : '') +
                    String(b.hour).padStart(2, '0') +
                    ':00'
                  )
                if (detail) return full.formatRange(date(b.from), date(b.to))
                return b.to - b.from > 24
                  ? monthly.format(date(b.from))
                  : short.format(date(b.from))
              }}
            />
          )}
          <UsageNavigator domain={domain} range={range} path={mini} onChange={changeRange} />
          <div className="usage-extent">
            <span>{full.format(date(domain.from))}</span>
            <span>{full.format(date(today))}</span>
          </div>
          <div className="usage-departments" role="group" aria-label={t('admin.usage.departments')}>
            {departments.map((dept) => (
              <button
                key={dept.id}
                type="button"
                aria-label={dept.name}
                aria-pressed={dept.id === selected}
                data-muted={(selected !== null && selected !== dept.id) || undefined}
                onClick={() => setSelected(selected === dept.id ? null : dept.id)}
              >
                <i
                  aria-hidden="true"
                  style={{ backgroundColor: departmentColor(dept.colorIndex) }}
                />
                <span>{dept.name}</span>
                <b>{number.format(totals.get(dept.id)?.[metric] ?? 0)}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function AiUsageChart() {
  const t = useT()
  const query = useQuery({
    queryKey: ['admin', 'ai-usage', 'daily'],
    queryFn: fetchAdminUsage,
    staleTime: 30_000,
  })
  if (query.isPending)
    return (
      <section className="usage-panel" aria-busy="true" aria-label={t('admin.usage.title')}>
        <div className="usage-heading">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-9 w-48" />
        </div>
        <Skeleton className="my-5 h-12 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="mt-3 h-9 w-full" />
      </section>
    )
  if (query.isError)
    return (
      <section className="usage-panel">
        <h2 className="text-h3">{t('admin.usage.title')}</h2>
        <p className="my-3 flex items-center gap-2 text-small text-muted-foreground">
          <Activity size={16} />
          {t('admin.console.analytics.aiSpendUnavailable')}
        </p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('state.error.action')}
        </Button>
      </section>
    )
  return <Panel data={query.data} />
}

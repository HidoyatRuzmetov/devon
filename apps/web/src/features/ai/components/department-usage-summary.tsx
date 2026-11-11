import { formatMonthYear, formatNumber, formatUzs, useLocale, useT } from '@devon/i18n'
import { Button, Skeleton } from '@devon/ui'
import * as React from 'react'
import { useAiUsageSummaryQuery } from '../use-ai.js'

function monthOptions(current: string, earliest: string | null) {
  const options: { value: string; date: Date }[] = []
  const cursor = new Date(`${current}-01T12:00:00Z`)
  for (
    let value = current;
    value >= (earliest ?? current);
    value = cursor.toISOString().slice(0, 7)
  ) {
    options.push({ value, date: new Date(cursor) })
    cursor.setUTCMonth(cursor.getUTCMonth() - 1)
  }
  return options
}

export function DepartmentUsageSummary() {
  const t = useT()
  const locale = useLocale()
  const [period, setPeriod] = React.useState('current')
  const current = useAiUsageSummaryQuery()
  const specificMonth = period === 'current' || period === 'all' ? undefined : period
  const historical = useAiUsageSummaryQuery(specificMonth, Boolean(specificMonth))
  const query = specificMonth ? historical : current
  const totals = period === 'all' ? current.data?.allTime : query.data?.monthly
  const currentMonth = current.data?.month
  const firstMonth = current.data?.firstMonth ?? null
  const months = React.useMemo(
    () => (currentMonth ? monthOptions(currentMonth, firstMonth) : []),
    [currentMonth, firstMonth],
  )
  const metrics = [
    { label: t('ai.usage.estimatedCost'), value: totals && formatUzs(totals.costUzs, locale) },
    { label: t('ai.usage.columns.tokens'), value: totals && formatNumber(totals.tokens, locale) },
    { label: t('ai.usage.calls'), value: totals && formatNumber(totals.runs, locale) },
  ]
  return (
    <section
      aria-labelledby="ai-usage-summary"
      className="space-y-4 rounded-xl border border-border bg-card p-4 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-usage-summary" className="text-body font-semibold text-foreground">
          {t('ai.usage.summary')}
        </h2>
        {currentMonth ? (
          <select
            aria-label={t('ai.usage.summaryPeriod')}
            value={period === 'current' ? currentMonth : period}
            onChange={(event) =>
              setPeriod(event.target.value === currentMonth ? 'current' : event.target.value)
            }
            className="h-9 max-w-full cursor-pointer rounded-md border border-border bg-card px-2 text-small text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">{t('ai.usage.filter.allTime')}</option>
            {months.map(({ value, date }) => (
              <option key={value} value={value}>
                {formatMonthYear(date, locale)}
              </option>
            ))}
          </select>
        ) : current.isPending ? (
          <Skeleton className="h-9 w-36" />
        ) : null}
      </div>
      {query.isError && !totals ? (
        <div role="status" className="flex items-center gap-3 text-small">
          {t('ai.usage.totalsUnavailable')}
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            {t('state.error.action')}
          </Button>
        </div>
      ) : (
        <dl
          aria-live="polite"
          aria-atomic="true"
          aria-busy={!totals}
          className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        >
          {metrics.map(({ label, value }) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-x-3 py-2 first:pt-0 last:pb-0 sm:block sm:py-0 sm:ps-5 sm:first:ps-0"
            >
              <dt className="text-caption text-muted-foreground">{label}</dt>
              <dd className="text-body font-semibold tabular-nums text-foreground sm:mt-1 sm:text-h3">
                {value ?? <Skeleton className="h-5 w-20" />}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

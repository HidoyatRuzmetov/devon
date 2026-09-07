// `/admin/analytics` -- global analytics: departments, people, activity, AI spend.
import { useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatDate, formatUzs } from '@devon/i18n'
import { Badge, KpiTile, StateView } from '@devon/ui'
import { fetchAdminAnalytics } from './api.js'
import { AdminScreen } from './admin-screen.js'
import { BarChart, ChartLegend, DonutChart, StatTile } from './charts.js'

function AnalyticsBody() {
  const t = useT()
  const locale = useLocale()
  const query = useQuery({ queryKey: ['admin', 'analytics'], queryFn: fetchAdminAnalytics })

  if (query.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (query.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => query.refetch() }}
      />
    )
  }

  const a = query.data
  const departmentSegments = [
    { label: t('admin.console.analytics.active'), value: a.departments.active },
    { label: t('admin.console.analytics.paused'), value: a.departments.paused },
    { label: t('admin.console.analytics.archived'), value: a.departments.archived },
  ]
  const roleSegments = [
    { label: t('admin.console.analytics.heads'), value: a.people.heads },
    { label: t('admin.console.analytics.members'), value: a.people.members },
    { label: t('admin.console.analytics.superAdmins'), value: a.people.superAdmins },
  ]
  const weeklyBars = a.activity.weeklyLogins.map((w) => ({
    label: formatDate(new Date(w.weekStart), locale),
    value: w.count,
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <KpiTile
          label={t('admin.console.analytics.totalDepartments')}
          value={a.departments.total}
        />
        <KpiTile label={t('admin.console.analytics.totalPeople')} value={a.people.total} />
        <KpiTile
          label={t('admin.console.analytics.cardsCreated30d')}
          value={a.activity.cardsCreated30d}
        />
        <KpiTile label={t('admin.console.analytics.logins7d')} value={a.activity.logins7d} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-6">
          <h2 className="mb-4 text-h3 text-foreground">
            {t('admin.console.analytics.departmentsTitle')}
          </h2>
          <div className="flex items-center gap-6">
            <DonutChart segments={departmentSegments} />
            <ChartLegend segments={departmentSegments} />
          </div>
        </section>
        <section className="rounded-md border border-border bg-card p-6">
          <h2 className="mb-4 text-h3 text-foreground">
            {t('admin.console.analytics.peopleTitle')}
          </h2>
          <div className="flex items-center gap-6">
            <DonutChart segments={roleSegments} />
            <ChartLegend segments={roleSegments} />
          </div>
        </section>
      </div>

      <section className="rounded-md border border-border bg-card p-6">
        <h2 className="mb-4 text-h3 text-foreground">
          {t('admin.console.analytics.activityTitle')}
        </h2>
        {weeklyBars.length === 0 ? (
          <p className="text-body text-muted-foreground">
            {t('admin.console.analytics.noActivity')}
          </p>
        ) : (
          <BarChart data={weeklyBars} />
        )}
        <p className="mt-2 text-small text-muted-foreground">
          {t('admin.console.analytics.weeklyLoginsCaption')}
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 text-foreground">{t('admin.console.analytics.aiSpendTitle')}</h2>
          {!a.aiSpend.available ? (
            <Badge tone="neutral">{t('admin.console.analytics.notAvailable')}</Badge>
          ) : null}
        </div>
        {a.aiSpend.available ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiTile
              label={t('admin.console.analytics.tokensThisMonth')}
              value={a.aiSpend.tokensThisMonth}
            />
            <StatTile
              label={t('admin.console.analytics.costThisMonth')}
              value={formatUzs(a.aiSpend.costUzsThisMonth, locale)}
            />
          </div>
        ) : (
          <p className="text-body text-muted-foreground">
            {t('admin.console.analytics.aiSpendUnavailable')}
          </p>
        )}
      </section>
    </div>
  )
}

export default function AnalyticsScreen() {
  return (
    <AdminScreen active="analytics">
      <AnalyticsBody />
    </AdminScreen>
  )
}

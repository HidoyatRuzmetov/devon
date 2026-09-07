// `/admin` -- overview + quick links. Supersedes `routes/admin.tsx`'s foundation placeholder (a
// smaller readyz-only health card): `app.tsx`'s route outlet matches this feature's exact-path route
// first (MODULE-GUIDE.md "Web features"), so this component now renders at `/admin` and the old
// `AdminRoute`/`routes/admin.tsx` file is unreachable dead code left for a follow-up cleanup pass
// (outside this module's own paths -- see this item's report).
import { useQuery } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { StateView } from '@devon/ui'
import { Link } from '../../lib/router.js'
import { fetchAdminInstanceDetail, fetchMaintenance } from './api.js'
import { AdminScreen } from './admin-screen.js'
import { StatTile } from './charts.js'

function DashboardBody() {
  const t = useT()
  const instanceQuery = useQuery({
    queryKey: ['admin', 'instance'],
    queryFn: fetchAdminInstanceDetail,
  })
  const maintenanceQuery = useQuery({
    queryKey: ['admin', 'maintenance'],
    queryFn: fetchMaintenance,
  })

  if (instanceQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  if (instanceQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => instanceQuery.refetch() }}
      />
    )
  }

  const instance = instanceQuery.data

  return (
    <div className="flex flex-col gap-6">
      {maintenanceQuery.data?.enabled ? (
        <div className="rounded-md border border-warning bg-warning/10 p-4 text-body text-foreground">
          {t('admin.console.dashboard.maintenanceActive')}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label={t('admin.console.dashboard.userCount')} value={instance.userCount} />
        <StatTile
          label={t('admin.console.dashboard.registration')}
          value={t(
            instance.registrationOpen
              ? 'admin.console.dashboard.registrationOpen'
              : 'admin.console.dashboard.registrationClosed',
          )}
        />
        <StatTile
          label={t('admin.console.dashboard.instanceKind')}
          value={t(
            instance.isDemo ? 'admin.console.dashboard.demo' : 'admin.console.dashboard.live',
          )}
        />
      </div>

      <section className="rounded-md border border-border bg-card p-6">
        <h2 className="mb-3 text-h3 text-foreground">{t('admin.console.dashboard.quickLinks')}</h2>
        <ul className="flex flex-col gap-2">
          <li>
            <Link to="/departments/requests" className="text-body text-primary hover:underline">
              {t('admin.console.dashboard.reviewRequests')}
            </Link>
          </li>
          <li>
            <Link to="/admin/departments" className="text-body text-primary hover:underline">
              {t('admin.console.dashboard.manageDepartments')}
            </Link>
          </li>
          <li>
            <Link to="/admin/accounts" className="text-body text-primary hover:underline">
              {t('admin.console.dashboard.manageAccounts')}
            </Link>
          </li>
          <li>
            <Link to="/admin/health" className="text-body text-primary hover:underline">
              {t('admin.console.dashboard.checkHealth')}
            </Link>
          </li>
        </ul>
      </section>
    </div>
  )
}

export default function DashboardScreen() {
  return (
    <AdminScreen active="dashboard">
      <DashboardBody />
    </AdminScreen>
  )
}

// `/admin/health` -- queues, DB, storage, Telegram, AI endpoint latency, backups.
import { useQuery } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Badge, Button, StateView } from '@devon/ui'
import { fetchAdminHealth, type HealthCheck } from './api.js'
import { AdminScreen } from './admin-screen.js'

const STATUS_TONE: Record<
  HealthCheck['status'],
  'success' | 'warning' | 'destructive' | 'neutral'
> = {
  ok: 'success',
  degraded: 'warning',
  down: 'destructive',
  not_configured: 'neutral',
}

function HealthRow({ labelKey, check }: { labelKey: string; check: HealthCheck }) {
  const t = useT()
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-body text-foreground">{t(labelKey)}</p>
        {check.detail ? <p className="text-small text-muted-foreground">{check.detail}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {check.latencyMs !== null ? (
          <span className="text-small text-muted-foreground">{check.latencyMs}ms</span>
        ) : null}
        <Badge tone={STATUS_TONE[check.status]}>
          {t(`admin.console.health.status.${check.status}`)}
        </Badge>
      </div>
    </li>
  )
}

function HealthBody() {
  const t = useT()
  const query = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: fetchAdminHealth,
    refetchInterval: 30_000,
  })

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

  const h = query.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-small text-muted-foreground">
          {t('admin.console.health.checkedAt', {
            time: new Date(h.checkedAt).toLocaleTimeString(),
          })}
        </p>
        <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
          {t('admin.console.health.refresh')}
        </Button>
      </div>
      <section className="rounded-md border border-border bg-card p-6">
        <ul className="divide-y divide-border">
          <HealthRow labelKey="admin.console.health.db" check={h.db} />
          <HealthRow labelKey="admin.console.health.queue" check={h.queue} />
          <HealthRow labelKey="admin.console.health.storage" check={h.storage} />
          <HealthRow labelKey="admin.console.health.telegram" check={h.telegram} />
          <HealthRow labelKey="admin.console.health.ai" check={h.ai} />
          <HealthRow labelKey="admin.console.health.backups" check={h.backups} />
        </ul>
      </section>
    </div>
  )
}

export default function HealthScreen() {
  return (
    <AdminScreen active="health">
      <HealthBody />
    </AdminScreen>
  )
}

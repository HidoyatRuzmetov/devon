// `/admin/health` -- queues, DB, storage, Telegram, AI endpoint latency, backups.
import { useQuery } from '@tanstack/react-query'
import { useT, useLocale, formatTime, formatNumber } from '@devon/i18n'
import { Badge, Button, Stagger, StaggerItem, StateView } from '@devon/ui'
import { fetchAdminHealth, type HealthCheck } from './api.js'
import { AdminScreen } from './admin-screen.js'
import { StatusDot } from './charts.js'

/** Formats a `HealthCheck.detail` (`{ code, params }`) into the sentence for the current locale --
 * `code` is looked up as `admin.console.health.detail.<code>`, and any numeric params are run through
 * `formatNumber` first (DESIGN.md §5's space grouping/uz-Latn fix) rather than interpolated raw, so a
 * pending-event count reads the same way every other number on the screen does. */
function useHealthDetailText(): (detail: HealthCheck['detail']) => string | null {
  const t = useT()
  const locale = useLocale()
  return (detail) => {
    if (!detail) return null
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(detail.params ?? {})) {
      params[key] = typeof value === 'number' ? formatNumber(value, locale) : value
    }
    return t(`admin.console.health.detail.${detail.code}`, params)
  }
}

// DESIGN.md §2.1: green stays reserved for success/approved/on-track (round2 SEV2 "Ishlayapti").
const STATUS_TONE: Record<
  HealthCheck['status'],
  'info' | 'warning' | 'destructive' | 'neutral'
> = {
  ok: 'info',
  degraded: 'warning',
  down: 'destructive',
  not_configured: 'neutral',
}

function HealthRow({ labelKey, check }: { labelKey: string; check: HealthCheck }) {
  const t = useT()
  const locale = useLocale()
  const detailText = useHealthDetailText()(check.detail)
  return (
    <StaggerItem as="li" className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <StatusDot status={check.status} />
        <div>
          <p className="text-body text-foreground">{t(labelKey)}</p>
          {detailText ? <p className="text-small text-muted-foreground">{detailText}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {check.latencyMs !== null ? (
          <span className="text-small tabular-nums text-muted-foreground">
            {formatNumber(check.latencyMs, locale)}{' '}ms
          </span>
        ) : null}
        <Badge tone={STATUS_TONE[check.status]}>
          {t(`admin.console.health.status.${check.status}`)}
        </Badge>
      </div>
    </StaggerItem>
  )
}

function HealthBody() {
  const t = useT()
  const locale = useLocale()
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
            time: formatTime(new Date(h.checkedAt), locale),
          })}
        </p>
        <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
          {t('admin.console.health.refresh')}
        </Button>
      </div>
      <section className="rounded-md border border-border bg-card p-6">
        <Stagger as="ul" className="divide-y divide-border">
          <HealthRow labelKey="admin.console.health.db" check={h.db} />
          <HealthRow labelKey="admin.console.health.queue" check={h.queue} />
          <HealthRow labelKey="admin.console.health.storage" check={h.storage} />
          <HealthRow labelKey="admin.console.health.telegram" check={h.telegram} />
          <HealthRow labelKey="admin.console.health.ai" check={h.ai} />
          <HealthRow labelKey="admin.console.health.backups" check={h.backups} />
        </Stagger>
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

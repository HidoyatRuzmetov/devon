// `/admin` (design.md §6.4, AC-11). Not-`super_admin` gets the `NoPermissionState` unconditionally --
// this is a client-side courtesy render only; the server denies the same way regardless (`can()`,
// `apps/api/src/plugins/authorize.ts`), so a member who bypasses this component entirely still gets
// nothing but 403s from every `/api/v1/admin/*` call (I-6).
import * as React from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { useT } from '@devon/i18n'
import { Badge, StateView } from '@devon/ui'
import { useForcedState } from '../lib/forced-state.js'
import { useMeQuery, useReadyzQuery } from '../lib/session.js'
import { useOnline } from '../lib/use-online.js'
import { navigate } from '../lib/router.js'
import { ForcedStateBlock } from '../shell/forced-state-block.js'
import type { Readyz } from '../lib/api-schemas.js'

function HealthRow({ label, up }: { label: string; up: boolean }) {
  const t = useT()
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span data-shell-label className="text-body text-foreground">
        {label}
      </span>
      <Badge tone={up ? 'success' : 'destructive'}>
        {up ? (
          <CircleCheck className="size-3.5" aria-hidden="true" />
        ) : (
          <CircleX className="size-3.5" aria-hidden="true" />
        )}
        <span data-shell-label>{t(up ? 'admin.health.up' : 'admin.health.down')}</span>
      </Badge>
    </li>
  )
}

export function AdminRoute() {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const isSuperAdmin = meQuery.data?.user.role === 'super_admin'
  const readyzQuery = useReadyzQuery(isSuperAdmin)

  const settled = !meQuery.isPending

  React.useEffect(() => {
    if (forced) return
    if (settled && meQuery.data === null) navigate('/login')
  }, [forced, settled, meQuery.data])

  if (forced) {
    return <ForcedStateBlock kind={forced} />
  }

  if (!settled) {
    return <StateView kind="loading" titleKey="state.loading" />
  }

  if (meQuery.data === null) return null // redirecting to /login

  if (!isSuperAdmin) {
    return (
      <StateView
        kind="forbidden"
        titleKey="state.denied.title"
        bodyKey="state.denied.body"
        action={{ labelKey: 'state.denied.action', onAction: () => navigate('/') }}
      />
    )
  }

  if (!online && readyzQuery.data === undefined) {
    return (
      <StateView
        kind="offline"
        titleKey="state.offline.banner"
        bodyKey="state.offline.empty"
        action={{ labelKey: 'state.error.action', onAction: () => readyzQuery.refetch() }}
      />
    )
  }

  if (readyzQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />

  if (readyzQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => readyzQuery.refetch() }}
      />
    )
  }

  const health: Readyz = readyzQuery.data
  return (
    <div className="mx-auto flex max-w-160 flex-col gap-6">
      <div>
        <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('admin.eyebrow')}
        </p>
        <h1 className="font-display text-h1 text-foreground">{t('admin.title')}</h1>
      </div>
      <section className="rounded-md border border-border bg-card p-6">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="text-h3 text-foreground">{t('admin.health.title')}</h2>
          <button
            type="button"
            onClick={() => readyzQuery.refetch()}
            className="rounded-sm px-2 py-1 text-small text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('admin.health.refresh')}
          </button>
        </div>
        <ul className="divide-y divide-border">
          <HealthRow label={t('admin.health.api')} up />
          <HealthRow label={t('admin.health.db')} up={health.db} />
          <HealthRow label={t('admin.health.queue')} up={health.valkey} />
        </ul>
      </section>
    </div>
  )
}

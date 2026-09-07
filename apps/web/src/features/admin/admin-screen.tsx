// Shared chrome for every `/admin/*` screen: the same forced-state/redirect/forbidden/offline guard
// `routes/admin.tsx` (the foundation's placeholder this feature's `/admin` route now supersedes --
// `app.tsx`'s route outlet checks a feature manifest's exact-path route before its own five-route
// switch, MODULE-GUIDE.md "Web features") already established, plus the console's tab nav.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { StateView } from '@devon/ui'
import { useForcedState } from '../../lib/forced-state.js'
import { useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { AdminTabs, type AdminTabId } from './tabs.js'

export function useIsSuperAdmin(): boolean {
  const meQuery = useMeQuery()
  return meQuery.data?.user.role === 'super_admin'
}

export function AdminScreen({
  active,
  children,
}: {
  active: AdminTabId
  children: React.ReactNode
}) {
  const t = useT()
  const forced = useForcedState()
  const online = useOnline()
  const meQuery = useMeQuery()
  const settled = !meQuery.isPending
  const isSuperAdmin = meQuery.data?.user.role === 'super_admin'

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

  if (!online) {
    return (
      <StateView kind="offline" titleKey="state.offline.banner" bodyKey="state.offline.empty" />
    )
  }

  return (
    <div className="mx-auto flex max-w-260 flex-col gap-6">
      <div>
        <p className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
          {t('admin.console.eyebrow')}
        </p>
        <h1 className="font-display text-h1 text-foreground">{t('admin.console.title')}</h1>
      </div>
      <AdminTabs active={active} />
      {children}
    </div>
  )
}

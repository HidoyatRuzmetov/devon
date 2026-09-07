// Shared chrome for every `/admin/*` screen: the same forced-state/redirect/forbidden/offline guard
// `routes/admin.tsx` (the foundation's placeholder this feature's `/admin` route now supersedes --
// `app.tsx`'s route outlet checks a feature manifest's exact-path route before its own five-route
// switch, MODULE-GUIDE.md "Web features") already established, plus the console's tab nav.
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, PageHeader, StateView, toast } from '@devon/ui'
import { useForcedState } from '../../lib/forced-state.js'
import { useMeQuery } from '../../lib/session.js'
import { useOnline } from '../../lib/use-online.js'
import { navigate } from '../../lib/router.js'
import { ForcedStateBlock } from '../../shell/forced-state-block.js'
import { AdminTabs, type AdminTabId } from './tabs.js'
import { stopViewAs } from './api.js'

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
  const queryClient = useQueryClient()
  const settled = !meQuery.isPending
  const isSuperAdmin = meQuery.data?.user.role === 'super_admin'
  // I-8b: `super_admin` is an instance-wide role that never also holds a real department membership,
  // so `activeDepartmentId` (`/me`, `modules/me/index.ts`) is non-null for a super_admin iff view-as
  // is currently active (it is seeded from `req.actor.viewAs`, exactly like a real membership would
  // seed it for anyone else) -- no separate flag needed to tell the two apart.
  const isViewingAs = isSuperAdmin && meQuery.data?.activeDepartmentId != null
  const csrfToken = meQuery.data?.csrfToken ?? ''
  const stopViewing = useMutation({
    mutationFn: () => stopViewAs(csrfToken),
    onSuccess: () => {
      toast(t('admin.console.departments.viewAsStoppedToast'))
      void meQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })

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
      <PageHeader
        eyebrow={t('admin.console.eyebrow')}
        title={t(`admin.console.tabs.${active}`)}
        tabs={<AdminTabs active={active} />}
      />
      {isViewingAs ? (
        // Blitz integration fix: this used to be the *only* exit control for view-as, and it lived
        // inside `departments-screen.tsx`'s own list -- but every `{kind:'instance'}` read (P1,
        // `packages/contracts/src/permissions.ts`) denies with `read_only_view_as` while `viewAs` is
        // set, `GET /api/v1/admin/departments` included, so that screen's list query 403'd and it
        // rendered a forbidden `StateView` instead of ever reaching the button -- a super admin who
        // started view-as had no reachable way back to admin console short of the cookie expiring on
        // its own. Hoisted here, in the chrome every `/admin/*` tab shares and that itself never reads
        // an `instance` subject, so it renders (and stays clickable) no matter which tab's own data
        // load is denied underneath it.
        <div className="flex items-center justify-between gap-4 rounded-md border border-warning bg-warning/10 px-4 py-3">
          <p className="text-small text-foreground">{t('admin.console.viewAsBanner.message')}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => stopViewing.mutate()}
            loading={stopViewing.isPending}
          >
            {t('admin.console.viewAsBanner.exit')}
          </Button>
        </div>
      ) : null}
      {children}
    </div>
  )
}

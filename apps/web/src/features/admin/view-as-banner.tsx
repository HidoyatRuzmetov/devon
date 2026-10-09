// The view-as exit banner (UI-OVERHAUL.md's "Admin console ... view-as"), factored out of
// `admin-screen.tsx` so it can render from `AppShell` too, on every route -- not only `/admin/*`.
//
// Blitz integration fix, round 2: starting view-as (`departments-screen.tsx`) navigates to `/` so the
// super admin actually sees the department's own screens, exactly what "view as" is for -- but the
// exit control lived only inside `AdminScreen`'s chrome, which `/` never renders. Live-verified
// (package `demo-super-admin`, `admin.super`): after "Ko'rinish sifatida ochish", `/me`'s
// `activeDepartmentId` is correctly set (server-side view-as works), yet nothing on Home said so and
// there was no reachable way back except typing `/admin` from memory -- the same "no reachable exit"
// class of bug the first blitz integration fix (see `admin-screen.tsx`'s own history) already fixed
// once for the `/admin/*` tabs themselves. This component is that same fix, generalised to the whole
// app: `AppShell` renders it on every non-`/admin*` route (admin-screen.tsx keeps its own copy for
// `/admin/*`, so the two never double up on one page).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, toast } from '@devon/ui'
import { useMeQuery } from '../../lib/session.js'
import { refreshViewAsContext } from './view-as-cache.js'

/** I-8b: `super_admin` never also holds a real department membership, so a super admin's
 * `activeDepartmentId` (`GET /me`) is non-null if and only if view-as is currently active -- no
 * separate boolean needed to tell the two apart (`admin-screen.tsx`'s `AdminScreen` established this
 * exact reasoning first; kept identical here rather than re-derived). */
export function useIsViewingAs(): boolean {
  const meQuery = useMeQuery()
  const isSuperAdmin = meQuery.data?.user.role === 'super_admin'
  return isSuperAdmin && meQuery.data?.activeDepartmentId != null
}

export function ViewAsBanner() {
  const t = useT()
  const meQuery = useMeQuery()
  const queryClient = useQueryClient()
  const csrfToken = meQuery.data?.csrfToken ?? ''

  const stopViewing = useMutation({
    mutationFn: () => import('./api.js').then(({ stopViewAs }) => stopViewAs(csrfToken)),
    onMutate: () => ({ ownerUserId: meQuery.data?.user.id }),
    onSuccess: async (_result, _variables, context) => {
      const changed = await refreshViewAsContext(
        queryClient,
        () => meQuery.refetch(),
        null,
        context.ownerUserId,
      )
      if (!changed) return
      toast(t('admin.console.departments.viewAsStoppedToast'))
    },
    onError: () => toast(t('admin.console.operationFailed')),
  })

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 rounded-md border border-warning bg-warning/10 px-4 py-3"
    >
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
  )
}

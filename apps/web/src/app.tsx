import * as React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { StateView, TooltipProvider } from '@devon/ui'
import { queryClient } from './lib/query-client.js'
import { reconcileLocaleWithUser } from './lib/locale-boot.js'
import { useMeQuery } from './lib/session.js'
import { useRouteName, useRoutePath } from './lib/router.js'
import { matchFeatureRoute } from './features/registry.js'
import { AppShell } from './shell/app-shell.js'
import { AuthShell } from './shell/auth-shell.js'
import { RouteErrorBoundary } from './shell/route-error-boundary.js'
import { HomeRoute } from './routes/home.js'
import { LoginRoute } from './routes/login.js'
import { SetupRoute } from './routes/setup.js'
import { AdminRoute } from './routes/admin.js'
import { NotFoundRoute } from './routes/not-found.js'

/** design.md §4.3/§8: once the signed-in user's own record resolves, its `locale` wins over whatever
 * `bootLocale()` guessed from storage/header (resolution order: user record → localStorage →
 * Accept-Language → default). Mounted once, above the route switch, so every route benefits without
 * each one re-implementing this reconciliation. */
function LocaleReconciler() {
  const meQuery = useMeQuery()
  const userLocale = meQuery.data?.user.locale
  React.useEffect(() => {
    if (userLocale) reconcileLocaleWithUser(userLocale)
  }, [userLocale])
  return null
}

/** design.md §6: five core routes, two chrome families -- `AppShell` (`/`, `/admin`, `/404`) and the
 * lighter `AuthShell` (`/login`, `/setup`). See `src/lib/router.tsx` for why this is a small
 * dependency-free switch rather than `@tanstack/react-router` in this item.
 *
 * A `src/features/<name>/manifest.ts(x)` route (MODULE-GUIDE.md "Web features") is checked first, by
 * exact pathname, before falling through to the five core routes below -- the switch itself is never
 * edited to add one. */
function RouteOutlet() {
  const path = useRoutePath()
  const name = useRouteName()

  const featureRoute = matchFeatureRoute(path)
  if (featureRoute) {
    const FeatureComponent = featureRoute.component
    return (
      <AppShell>
        <RouteErrorBoundary>
          <React.Suspense fallback={<StateView kind="loading" titleKey="state.loading" />}>
            <FeatureComponent />
          </React.Suspense>
        </RouteErrorBoundary>
      </AppShell>
    )
  }

  switch (name) {
    case 'home':
      return (
        <AppShell>
          <RouteErrorBoundary>
            <HomeRoute />
          </RouteErrorBoundary>
        </AppShell>
      )
    case 'admin':
      return (
        <AppShell>
          <RouteErrorBoundary>
            <AdminRoute />
          </RouteErrorBoundary>
        </AppShell>
      )
    case 'login':
      return (
        <AuthShell>
          <RouteErrorBoundary>
            <LoginRoute />
          </RouteErrorBoundary>
        </AuthShell>
      )
    case 'setup':
      return (
        <AuthShell>
          <RouteErrorBoundary>
            <SetupRoute />
          </RouteErrorBoundary>
        </AuthShell>
      )
    case 'not-found':
    default:
      return (
        <AppShell>
          <RouteErrorBoundary>
            <NotFoundRoute />
          </RouteErrorBoundary>
        </AppShell>
      )
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LocaleReconciler />
        <RouteOutlet />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

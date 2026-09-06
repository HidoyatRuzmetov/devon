import * as React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@devon/ui'
import { queryClient } from './lib/query-client.js'
import { reconcileLocaleWithUser } from './lib/locale-boot.js'
import { useMeQuery } from './lib/session.js'
import { useRouteName } from './lib/router.js'
import { AppShell } from './shell/app-shell.js'
import { AuthShell } from './shell/auth-shell.js'
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

/** design.md §6: five routes, two chrome families -- `AppShell` (`/`, `/admin`, `/404`) and the
 * lighter `AuthShell` (`/login`, `/setup`). See `src/lib/router.tsx` for why this is a small
 * dependency-free switch rather than `@tanstack/react-router` in this item. */
function RouteOutlet() {
  const name = useRouteName()
  switch (name) {
    case 'home':
      return (
        <AppShell>
          <HomeRoute />
        </AppShell>
      )
    case 'admin':
      return (
        <AppShell>
          <AdminRoute />
        </AppShell>
      )
    case 'login':
      return (
        <AuthShell>
          <LoginRoute />
        </AuthShell>
      )
    case 'setup':
      return (
        <AuthShell>
          <SetupRoute />
        </AuthShell>
      )
    case 'not-found':
    default:
      return (
        <AppShell>
          <NotFoundRoute />
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

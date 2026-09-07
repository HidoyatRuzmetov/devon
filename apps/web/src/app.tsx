import * as React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionProvider, RouteSkeleton, TooltipProvider } from '@devon/ui'
import { useT } from '@devon/i18n'
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

/** Routes a signed-out visitor reaches, which therefore render in the light `AuthShell` rather than
 * the full product chrome (UI-OVERHAUL.md §2 row 3: "Auth (login, register, setup, join)"). Two of
 * them are *feature* routes (`/register` from `features/accounts`, `/join` from
 * `features/departments`) -- before the overhaul they rendered inside `AppShell`, which put a
 * sidebar full of destinations around a person who has no session yet. Kept as a path list here,
 * next to the switch that uses it, rather than as a manifest flag: "does this screen have a session"
 * is a fact about the shell, not about the feature. */
const AUTH_ROUTES = new Set(['/login', '/setup', '/register', '/join'])

/** Every lazy route renders a page-shaped skeleton while its chunk downloads, never a spinner and
 * never a blank frame (DESIGN.md §4). */
function RouteFallback() {
  const t = useT()
  return <RouteSkeleton label={t('shell.loading.route')} />
}

/** design.md §6: five core routes and two chrome families -- `AppShell` for the product, the lighter
 * `AuthShell` for the signed-out screens. See `src/lib/router.tsx` for why this is a small
 * dependency-free switch rather than `@tanstack/react-router` in this item.
 *
 * A `src/features/<name>/manifest.ts(x)` route (MODULE-GUIDE.md "Web features") is checked first, by
 * exact pathname, before falling through to the core routes below -- the switch itself is never
 * edited to add one. */
function RouteOutlet() {
  const path = useRoutePath()
  const name = useRouteName()

  const featureRoute = matchFeatureRoute(path)
  if (featureRoute) {
    const FeatureComponent = featureRoute.component
    const Shell = AUTH_ROUTES.has(path) ? AuthShell : AppShell
    return (
      <Shell>
        <RouteErrorBoundary>
          <React.Suspense fallback={<RouteFallback />}>
            <FeatureComponent />
          </React.Suspense>
        </RouteErrorBoundary>
      </Shell>
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
      {/* `reducedMotion="user"` at the root: every `motion` component below drops its transforms
          when the OS asks, and each catalogue piece additionally substitutes a designed replacement
          (DESIGN.md §2.5 -- replace, never delete). */}
      <MotionProvider>
        <TooltipProvider delayDuration={200}>
          <LocaleReconciler />
          <RouteOutlet />
        </TooltipProvider>
      </MotionProvider>
    </QueryClientProvider>
  )
}

// Exported for the shell tests, which assert the auth-route list without mounting a whole route.
export { AUTH_ROUTES }

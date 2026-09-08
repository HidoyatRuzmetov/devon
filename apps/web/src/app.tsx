import * as React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionProvider, RouteSkeleton, TooltipProvider } from '@devon/ui'
import { useT } from '@devon/i18n'
import { queryClient } from './lib/query-client.js'
import { reconcileLocaleWithUser } from './lib/locale-boot.js'
import { useMeQuery } from './lib/session.js'
import { useRouteName, useRoutePath } from './lib/router.js'
import { usePageHead } from './lib/page-meta.js'
import { matchFeatureRoute } from './features/registry.js'
import { AppShell } from './shell/app-shell.js'
import { AuthShell } from './shell/auth-shell.js'
import { RouteErrorBoundary } from './shell/route-error-boundary.js'

// H4.3 (route-level code splitting): every `features/*/manifest.ts(x)` route is already
// `React.lazy` -- these four core routes were the one place that wasn't, so their weight (plus
// `routes/login.tsx`'s and `routes/setup.tsx`'s own form-handling code) sat in the eagerly
// `modulepreload`ed entry chunk on *every* route, not just their own. `HomeRoute` is the most
// direct win: `features/home/manifest.tsx` claims `/` first (MODULE-GUIDE.md "Web features"), so
// the `'home'` case below is provably unreachable in production -- it was dead code shipped to
// every single visitor's initial bundle. None of the six routes H24.1 measures (`/`, `/work`,
// `/work/table`, `/events`, `/inbox`, `/analytics`) needs any of these four, so this is a pure win
// for that measurement; `/login` itself pays one extra chunk fetch on a cold cache in exchange
// (the same trade-off every other feature route already makes).
const HomeRoute = React.lazy(() =>
  import('./routes/home.js').then((m) => ({ default: m.HomeRoute })),
)
const LoginRoute = React.lazy(() =>
  import('./routes/login.js').then((m) => ({ default: m.LoginRoute })),
)
const SetupRoute = React.lazy(() =>
  import('./routes/setup.js').then((m) => ({ default: m.SetupRoute })),
)
const NotFoundRoute = React.lazy(() =>
  import('./routes/not-found.js').then((m) => ({ default: m.NotFoundRoute })),
)

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
/** Core (non-feature) routes' `titleKey`s (`'home'` is unreachable in practice -- `features/home`'s
 * manifest claims `/` first, MODULE-GUIDE.md "Web features" -- but is covered anyway so every
 * `RouteName` this switch can produce ends up with a real, translated `<title>`, H23.1). */
function coreTitleKey(name: ReturnType<typeof useRouteName>): string {
  switch (name) {
    case 'login':
      return 'login.title'
    case 'setup':
      return 'setup.title'
    case 'home':
      return 'home.eyebrow'
    case 'not-found':
    default:
      return 'state.notfound.title'
  }
}

function RouteOutlet() {
  const path = useRoutePath()
  const name = useRouteName()
  const t = useT()

  const featureRoute = matchFeatureRoute(path)
  // H23.1: every route's `<title>`/`<meta name="robots">`/canonical link, set unconditionally
  // (before the early returns below) so the Rules of Hooks hold regardless of which branch renders.
  // `AUTH_ROUTES` are the public entry points (H23.1: "login, join... noindex" is only for *app*
  // routes) -- everything else requires a session and is never meant to be indexed.
  usePageHead({
    title: featureRoute ? t(featureRoute.titleKey) : t(coreTitleKey(name)),
    description: AUTH_ROUTES.has(path) ? t('auth.tagline') : undefined,
    noindex: !AUTH_ROUTES.has(path),
  })

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
            <React.Suspense fallback={<RouteFallback />}>
              <HomeRoute />
            </React.Suspense>
          </RouteErrorBoundary>
        </AppShell>
      )
    case 'login':
      return (
        <AuthShell>
          <RouteErrorBoundary>
            <React.Suspense fallback={<RouteFallback />}>
              <LoginRoute />
            </React.Suspense>
          </RouteErrorBoundary>
        </AuthShell>
      )
    case 'setup':
      return (
        <AuthShell>
          <RouteErrorBoundary>
            <React.Suspense fallback={<RouteFallback />}>
              <SetupRoute />
            </React.Suspense>
          </RouteErrorBoundary>
        </AuthShell>
      )
    case 'not-found':
    default:
      return (
        <AppShell>
          <RouteErrorBoundary>
            <React.Suspense fallback={<RouteFallback />}>
              <NotFoundRoute />
            </React.Suspense>
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

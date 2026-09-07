// A small, dependency-free router for the five routes this item ships (design.md §6: `/`, `/login`,
// `/setup`, `/admin`, `/404`). TECH-SPEC §1.2 pins `@tanstack/react-router` for the product; that
// library's loader/data model earns its weight once EPIC-002+ add nested, param-bearing routes
// (`/join/:key`, department switching). For a five-route foundation shell with no route params and
// no loaders, this file is the whole surface a swap would touch (`useRoutePath`, `navigate`,
// `RouterLink`) -- flagged in this item's NOTES for `wp-architect`/`wp-lead` to confirm rather than
// silently committing the product to a different router.
import * as React from 'react'

// 'admin' was removed from this union (blitz integration pass): `/admin` is now a feature route
// (`features/admin/manifest.ts`) matched by `app.tsx`'s `matchFeatureRoute` before this name is ever
// consulted, so `routeNameForPath('/admin')` falling through to `'not-found'` below is never observed.
export type RouteName = 'home' | 'login' | 'setup' | 'not-found'

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  window.addEventListener('popstate', callback)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('popstate', callback)
  }
}

function getPathSnapshot(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

function getSearchSnapshot(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

export function useRoutePath(): string {
  return React.useSyncExternalStore(subscribe, getPathSnapshot, () => '/')
}

/** Re-renders on every navigation (`navigate()` or back/forward), including a search-string-only
 * change (`?__state=…`, design.md §8) that `useRoutePath` alone would not catch. */
export function useSearchParams(): URLSearchParams {
  const search = React.useSyncExternalStore(subscribe, getSearchSnapshot, () => '')
  return React.useMemo(() => new URLSearchParams(search), [search])
}

export function routeNameForPath(pathname: string): RouteName {
  switch (pathname) {
    case '/':
      return 'home'
    case '/login':
      return 'login'
    case '/setup':
      return 'setup'
    default:
      return 'not-found'
  }
}

export function useRouteName(): RouteName {
  return routeNameForPath(useRoutePath())
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  const current = window.location.pathname + window.location.search
  if (current === to) return
  if (options?.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  notify()
}

/** Sets (or clears, when `value` is `null`) a single search param without touching the others or
 * pushing a new history entry -- used for the `?__state=` forcing param (design.md §8) so toggling it
 * for a screenshot never grows the back-button stack. */
export function replaceSearchParam(name: string, value: string | null): void {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  notify()
}

function isModifiedOrNonPrimary(e: React.MouseEvent): boolean {
  return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

/** Matches the `href`-accepting interface `@devon/ui`'s `Sidebar` expects from its `linkAs` prop
 * (`packages/ui/src/shell/sidebar.tsx`: "Pass a router's Link ... this package has no router
 * dependency of its own"). Falls through to a real navigation for a modified click / new-tab
 * shortcut, exactly like every other in-app link. */
export const RouterLink = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>(({ href = '/', onClick, children, ...rest }, ref) => (
  <a
    ref={ref}
    href={href}
    onClick={(e) => {
      onClick?.(e)
      if (isModifiedOrNonPrimary(e)) return
      e.preventDefault()
      navigate(href)
    }}
    {...rest}
  >
    {children}
  </a>
))
RouterLink.displayName = 'RouterLink'

export function Link({
  to,
  children,
  ...rest
}: { to: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <RouterLink href={to} {...rest}>
      {children}
    </RouterLink>
  )
}

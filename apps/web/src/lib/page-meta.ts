// H23.1 (SEO/web basics): "Public pages (login, join, maintenance) have titles/meta, robots.txt
// disallows the app, canonical URLs, correct status codes; app routes noindex." A single-page app
// serves one static `index.html` for every path (`src/index.html`'s `<title>` is a fixed
// "WorkPortal"), so `document.title`, `<meta name="description">`, `<meta name="robots">` and the
// canonical `<link>` can only ever vary by route from inside the client -- this is that one place.
//
// Every `FeatureRoute.titleKey` (`features/types.ts`) already existed before this file did but was
// never read anywhere (verified: no `document.title` write existed in this app at all) -- wiring it
// here is the fix, not a new convention.
import * as React from 'react'

const APP_NAME = 'WorkPortal'

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

export interface PageHeadOptions {
  /** Already-translated page title, without the app-name suffix (I-9: never a literal string at the
   * call site -- callers pass `t(titleKey)`, never hardcode English here). */
  title: string
  /** Already-translated one-line description. Public entry points only (H23.1); `undefined` (falls
   * back to nothing rendered) for authenticated app routes, which carry no indexable content anyway. */
  description: string | undefined
  /** `true` for every route that requires a session (H23.1 "app routes noindex"); `false` for the
   * public entry points (login, setup, register, join) a real visitor can land on directly. */
  noindex: boolean
}

/** Sets the four route-varying `<head>` facts for the current pathname. Called once, unconditionally,
 * from `app.tsx`'s `RouteOutlet` on every render -- cheap (four DOM attribute writes, no re-render
 * triggered) and correct on back/forward navigation since it is keyed off `window.location.pathname`
 * at effect-run time, not a snapshot taken once. */
export function usePageHead({ title, description, noindex }: PageHeadOptions): void {
  React.useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow')
    if (description) upsertMeta('name', 'description', description)
    upsertCanonical(window.location.origin + window.location.pathname)
    // No cleanup: the next route's effect overwrites every one of these in place (a `<head>` has
    // exactly one of each), so there is nothing to unset on unmount.
  }, [title, description, noindex])
}

// Typed loader for `../routes.json` (this item's handoff contract, `routes.schema.json`). Read with
// `readFileSync`+`JSON.parse` rather than a JSON import so this file's module format never depends on
// how a given TS/Node version wants import-attribute syntax spelled -- one less thing to keep in sync
// with `tsconfig.json`/Playwright's own transform.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_DIR } from './env.js'

export type RouteAuth = 'public' | 'session' | 'super_admin'
export type RouteChrome = 'auth' | 'app'
export type RouteRole = 'head' | 'member' | 'super_admin'

export interface RouteEntry {
  path: string
  name: string
  slug: string
  auth: RouteAuth
  chrome: RouteChrome
  requires?: readonly string[]
  heading?: string
  /** v1.1: which personas the screenshot manifest captures this route as. Absent = the head alone,
   * which is every route's original behaviour. A head-only destination lists both, so the set
   * carries the real screen *and* the no-permission state a xodim meets on it. */
  roles?: readonly RouteRole[]
}

let cached: RouteEntry[] | null = null

export function loadRoutes(): RouteEntry[] {
  if (cached) return cached
  const raw = readFileSync(join(E2E_DIR, 'routes.json'), 'utf8')
  const parsed = JSON.parse(raw) as { routes: RouteEntry[] }
  cached = parsed.routes
  return cached
}

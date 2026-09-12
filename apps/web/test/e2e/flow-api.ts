// Small HTTP primitives shared by every `*.flow.spec.ts` (H30.1). Each flow proves its own state
// transition through real UI where that is the point of the flow (register, join, the admin console's
// pause control); everything upstream of that -- creating a department, seeding a second member, a
// card/project/event/sprint to act on -- goes through the same real `/api/v1/*` contracts the product's
// own client uses. This keeps six real, working end-to-end flows inside one hardening pass's budget
// without re-deriving every screen's exact DOM for state this suite is not trying to prove.
import { readFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import type { APIResponse, Browser, BrowserContext } from '@playwright/test'
import { FLOW_SUPERADMIN_FILE, FLOW_WEB_BASE_URL, type FlowSuperAdmin } from './flow-env.js'

/** `browser.newContext()` does not automatically pick up `playwright.config.ts`'s `use.baseURL` the
 * way the `context`/`page` test fixtures do -- every flow spec that needs a *second* (or third)
 * independent session (a separate actor, so a separate cookie jar) creates it through this, not the
 * bare Playwright call, so its `context.request.post('/api/v1/...')` calls resolve against the right
 * server instead of erroring on a relative URL with no base. */
export function newFlowContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: FLOW_WEB_BASE_URL })
}

export function uniqueLogin(prefix: string): string {
  return `${prefix}.${randomUUID().slice(0, 8)}`
}

/** Meets `passwordSchema`/`setupBodySchema`'s length floor comfortably; "Example" keeps
 * `check-secrets.mjs` happy on the rare path a value like this ever appears in a failure message. */
export function examplePassword(): string {
  return `FlowExample-${randomBytes(6).toString('base64url')}Aa1`
}

/**
 * `lib/cookies.ts` sets every session/CSRF cookie `secure: true` unconditionally (correct for
 * production; this suite runs its real `apps/api`/`apps/web` over plain HTTP, deliberately -- no TLS
 * termination in a local hardening-suite harness). A `Secure` `Set-Cookie` a plain-HTTP response tries
 * to establish is dropped by the normal cookie jar (this is `APIRequestContext`'s behaviour too, not
 * only a real browser's) -- `e2e/lib/backend.ts`'s `cookiesToStorageState` works around the identical
 * problem the same way: parse the raw `Set-Cookie` headers by hand and inject them into the context
 * directly via `addCookies`, which is not subject to the scheme check a network response is.
 */
async function applySetCookies(context: BrowserContext, res: APIResponse): Promise<void> {
  const raw = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie')
  if (raw.length === 0) return
  const url = new URL(res.url())
  const cookies = raw.map((h) => {
    const parts = h.value.split(';').map((p) => p.trim())
    const first = parts[0]!
    const eq = first.indexOf('=')
    const name = first.slice(0, eq)
    const value = first.slice(eq + 1)
    let path = '/'
    let sameSite: 'Strict' | 'Lax' | 'None' = 'Lax'
    let httpOnly = false
    for (const attr of parts.slice(1)) {
      const [rawKey, rawVal] = attr.split('=')
      const key = rawKey?.trim().toLowerCase()
      if (key === 'path' && rawVal) path = rawVal.trim()
      else if (key === 'samesite' && rawVal) {
        const v = rawVal.trim().toLowerCase()
        sameSite = v === 'strict' ? 'Strict' : v === 'none' ? 'None' : 'Lax'
      } else if (key === 'httponly') httpOnly = true
    }
    // `secure: false` here is the deliberate part of the workaround described above -- this suite's
    // whole point for this cookie is "the browser sends it back on the next same-origin request",
    // which `addCookies` honours regardless of scheme once the flag no longer blocks it.
    return { name, value, domain: url.hostname, path, httpOnly, secure: false, sameSite }
  })
  await context.addCookies(cookies)
}

/**
 * A real `page.goto()`-driven login/register (as opposed to this file's own `registerUser`/`login`)
 * gets its session cookie the normal way -- a `Set-Cookie` response to the page's own in-page
 * `fetch()` -- and Chromium's page-level network stack *does* apply the "loopback address is a
 * trustworthy origin" exception, so a `Secure` cookie over plain `http://127.0.0.1` is accepted there.
 * Playwright's separate `APIRequestContext` (`context.request`/`page.request`, a distinct network
 * client sharing only the cookie *store*, not the page's rendering-engine security policy) does not
 * extend that same exception when *sending* a request, so a direct `page.request.get(...)` call after
 * an otherwise-working real-UI login still 401s. Re-applying every current cookie through
 * `addCookies` with `secure: false` (same technique `applySetCookies` above uses) fixes exactly that,
 * without touching anything the page itself does. Call this once, right before the first
 * `page.request.*` call a spec makes after a real-UI login/register. */
export async function stripSecureCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies()
  await context.addCookies(cookies.map((c) => ({ ...c, secure: false })))
}

export async function csrfToken(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies()
  const csrf = cookies.find((c) => c.name === 'devon_csrf')
  if (!csrf) throw new Error('no devon_csrf cookie in this context -- register/login first')
  return csrf.value
}

function jsonHeaders(csrf?: string): Record<string, string> {
  return csrf ? { 'content-type': 'application/json', 'x-csrf-token': csrf } : {}
}

export async function registerUser(
  context: BrowserContext,
  opts: { login: string; password: string; givenName: string; familyName: string },
): Promise<void> {
  const res = await context.request.post('/api/v1/accounts/register', {
    data: {
      login: opts.login,
      password: opts.password,
      givenName: opts.givenName,
      familyName: opts.familyName,
      timezone: 'Asia/Tashkent',
    },
  })
  if (res.status() !== 201) {
    throw new Error(`register(${opts.login}) failed: ${res.status()} ${await res.text()}`)
  }
  await applySetCookies(context, res)
}

export async function login(
  context: BrowserContext,
  opts: { login: string; password: string },
): Promise<void> {
  const res = await context.request.post('/api/v1/auth/login', { data: opts })
  if (res.status() !== 204) {
    throw new Error(`login(${opts.login}) failed: ${res.status()} ${await res.text()}`)
  }
  await applySetCookies(context, res)
}

export function readSuperAdmin(): FlowSuperAdmin {
  return JSON.parse(readFileSync(FLOW_SUPERADMIN_FILE, 'utf8')) as FlowSuperAdmin
}

/** End to end: registers a fresh head, files a department request, and -- using a *separate*
 * super_admin context -- approves it immediately (design.md §2.2: "approved once by the super admin,
 * creator becomes head"). Returns everything a flow spec needs to seed further state without
 * re-driving the multi-step `/departments/new` stepper UI for every flow that merely needs an
 * *existing* department (the `register-department-join` flow is the one spec that drives that stepper
 * for real). */
export async function createApprovedDepartment(
  headContext: BrowserContext,
  superAdminContext: BrowserContext,
  opts: { headLogin: string; headPassword: string; departmentName: string },
): Promise<{ departmentId: string; joinKey: string; joinPassword: string }> {
  await registerUser(headContext, {
    login: opts.headLogin,
    password: opts.headPassword,
    givenName: 'Test',
    familyName: 'Head',
  })
  const headCsrf = await csrfToken(headContext)
  const reqRes = await headContext.request.post('/api/v1/departments/requests', {
    data: { name: opts.departmentName, units: [] },
    headers: jsonHeaders(headCsrf),
  })
  if (reqRes.status() !== 201) {
    throw new Error(`department request failed: ${reqRes.status()} ${await reqRes.text()}`)
  }
  const { id: requestId } = (await reqRes.json()) as { id: string }

  // No request body for this route -- `content-type: application/json` with an empty body is itself
  // a 400 at Fastify's parser (`FST_ERR_CTP_EMPTY_JSON_BODY`), so only the CSRF header goes here,
  // never `jsonHeaders()` (which always sets `content-type`, correctly, for every call that *does*
  // carry a JSON body).
  const superAdminCsrf = await csrfToken(superAdminContext)
  const approveRes = await superAdminContext.request.post(
    `/api/v1/departments/requests/${requestId}/approve`,
    { headers: { 'x-csrf-token': superAdminCsrf } },
  )
  if (approveRes.status() !== 200) {
    throw new Error(`approve failed: ${approveRes.status()} ${await approveRes.text()}`)
  }
  return (await approveRes.json()) as {
    departmentId: string
    joinKey: string
    joinPassword: string
  }
}

/** Registers a second user and joins them into an already-approved department via the real
 * `POST /join` contract (never a direct DB insert) -- every flow that needs a second member (board
 * move's second column, the group-project flow's collaborator) gets one this way. */
export async function joinDepartmentAsNewUser(
  context: BrowserContext,
  opts: { login: string; password: string; joinKey: string; joinPassword: string },
): Promise<void> {
  await registerUser(context, {
    login: opts.login,
    password: opts.password,
    givenName: 'Test',
    familyName: 'Member',
  })
  const csrf = await csrfToken(context)
  const res = await context.request.post('/api/v1/departments/join', {
    data: { key: opts.joinKey, password: opts.joinPassword },
    headers: jsonHeaders(csrf),
  })
  if (res.status() !== 200) {
    throw new Error(`join failed: ${res.status()} ${await res.text()}`)
  }
}

/** Logs the already-bootstrapped super_admin into `context` -- the one session every flow needing
 * admin approval or the admin console shares this same helper for. */
export async function loginAsSuperAdmin(context: BrowserContext): Promise<void> {
  await login(context, readSuperAdmin())
}

/** POST/PATCH helper: attaches the CSRF header this context's cookie jar carries. */
export async function authedPost(context: BrowserContext, url: string, data?: unknown) {
  const csrf = await csrfToken(context)
  return context.request.post(url, { data, headers: jsonHeaders(csrf) })
}

export async function authedPatch(context: BrowserContext, url: string, data?: unknown) {
  const csrf = await csrfToken(context)
  return context.request.patch(url, { data, headers: jsonHeaders(csrf) })
}

// Bootstraps a real `super_admin` session against a running `apps/api` (design.md §1.7's
// `POST /api/v1/setup/{token}` / `POST /api/v1/auth/login`), the same contract
// `apps/api/test/checks/setup-prove.ts` exercises for AC-12. Used by `global-setup.ts` to produce a
// Playwright `storageState` for spec.md §12's baseline grid ("Session: `/` and `/admin` as
// `super_admin` in demo mode") and by anything that needs a signed-in `super_admin` page.
//
// The API prints the one-time setup link as a plain `console.log` line (`printSetupUrlIfNeeded`) in
// the form `${DEVON_PUBLIC_URL}/setup/${token}` -- a *path*-style URL. `apps/web`'s `/setup` route
// reads the token from a `?token=` *query* string instead (`apps/web/src/routes/setup.tsx`). That
// mismatch is a real gap between two other work items' output, outside this item's TOUCHES to fix; this
// file works around it by extracting the raw token substring itself (whichever form it arrives in) and
// talking to the API directly, which is what `setup:prove` does too.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { API_BASE_URL, TMP_DIR } from './env.js'

export interface SuperAdminCredentials {
  login: string
  password: string
  givenName: string
  familyName: string
}

const CREDENTIALS_FILE = join(TMP_DIR, 'superadmin-credentials.json')

/** The one example password in this suite -- "Example" keeps `agentic/scripts/check-secrets.mjs`'s
 * allowlist happy (same convention `apps/api/test/checks/setup-prove.ts` already uses), and it is
 * never anything but a throwaway local Testcontainers/dev-Postgres row. */
export const DEFAULT_CREDENTIALS: SuperAdminCredentials = {
  login: 'e2e.superadmin',
  password: 'E2eProveExample123!',
  givenName: 'Aziz',
  familyName: 'Yusupov',
}

/** Matches the token whether it arrived as `.../setup/<token>` (what the API currently prints) or
 * `...?token=<token>` (what the API endpoint's own path param and the web route's query param both
 * ultimately need the raw value for). */
function extractSetupToken(url: string): string | null {
  const asQuery = /[?&]token=([^&\s]+)/.exec(url)
  if (asQuery?.[1]) return decodeURIComponent(asQuery[1])
  const asPath = /\/setup\/([^/?\s]+)/.exec(url)
  return asPath?.[1] ?? null
}

export function findSetupUrlInOutput(lines: readonly string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^https?:\/\/.*\/setup\//.test(trimmed)) return trimmed
  }
  return null
}

async function readCachedCredentials(): Promise<SuperAdminCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_FILE, 'utf8')
    return JSON.parse(raw) as SuperAdminCredentials
  } catch {
    return null
  }
}

async function cacheCredentials(creds: SuperAdminCredentials): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true })
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), 'utf8')
}

async function login(creds: SuperAdminCredentials): Promise<{ cookies: string[] } | null> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: creds.login, password: creds.password }),
  })
  if (res.status !== 204) return null
  const cookies = res.headers.getSetCookie?.() ?? []
  return { cookies }
}

/**
 * Ensures a `super_admin` account exists and returns credentials + a valid session's cookies.
 *
 * - If a setup link is visible in `apiOutput` (the api process's captured stdout, see
 *   `process-utils.ts`'s `ManagedProcess.output`), consumes it to create the account.
 * - Else, if credentials from a previous run are cached (`.tmp/superadmin-credentials.json`, this
 *   item's own scratch space -- never committed), logs in with those (the setup link is single-use,
 *   so a second run against the same, already-bootstrapped database must not need a fresh one).
 * - Else returns `null`: no setup link was ever printed and there is nothing cached, so this run
 *   cannot produce a `super_admin` session (either the API never started, or a super admin already
 *   existed from a source outside this suite's control -- e.g. a previous `pnpm start --demo`).
 */
export async function ensureSuperAdminSession(
  apiOutput: readonly string[],
): Promise<{ credentials: SuperAdminCredentials; cookies: string[] } | null> {
  const setupUrl = findSetupUrlInOutput(apiOutput)
  if (setupUrl) {
    const token = extractSetupToken(setupUrl)
    if (!token) {
      console.log(`[backend] found a setup URL but could not extract a token from it: ${setupUrl}`)
    } else {
      const creds = DEFAULT_CREDENTIALS
      const res = await fetch(`${API_BASE_URL}/api/v1/setup/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login: creds.login,
          password: creds.password,
          givenName: creds.givenName,
          familyName: creds.familyName,
          locale: 'uz-Latn',
        }),
      })
      if (res.status === 201) {
        await cacheCredentials(creds)
        const session = await login(creds)
        if (session) return { credentials: creds, cookies: session.cookies }
      } else {
        console.log(`[backend] POST /api/v1/setup/{token} -> ${res.status} (expected 201)`)
      }
    }
  }

  const cached = await readCachedCredentials()
  if (cached) {
    const session = await login(cached)
    if (session) return { credentials: cached, cookies: session.cookies }
    console.log('[backend] cached super_admin credentials no longer authenticate (fresh database?)')
  }

  return null
}

export interface StorageStateCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

/** Parses `Set-Cookie` response header strings into the exact shape
 * `browser.newContext({ storageState })`'s `cookies[]` needs (this suite writes that file to
 * `.tmp/superadmin-storage-state.json`, `global-setup.ts`) -- reads every attribute off the real
 * header instead of assuming ADR-003's values, so this file keeps working if session cookie policy
 * ever changes. `domain` always wins from `hostname`, not from a `Domain=` attribute: the API issues
 * `devon_sid`/`devon_csrf` with no `Domain` at all (ADR-003: host-only, per I-1's session hardening),
 * and Playwright's storageState schema requires a concrete domain either way. */
export function cookiesToStorageState(
  setCookieHeaders: readonly string[],
  hostname: string,
): StorageStateCookie[] {
  return setCookieHeaders
    .map((header): StorageStateCookie | null => {
      const parts = header.split(';').map((p) => p.trim())
      const first = parts[0]
      const eq = first?.indexOf('=') ?? -1
      if (!first || eq < 0) return null
      const name = first.slice(0, eq)
      const value = first.slice(eq + 1)

      let path = '/'
      let sameSite: StorageStateCookie['sameSite'] = 'Lax'
      let expires = -1
      let httpOnly = false
      let secure = false
      for (const attr of parts.slice(1)) {
        const [rawKey, rawVal] = attr.split('=')
        const key = rawKey?.trim().toLowerCase()
        if (key === 'path' && rawVal) path = rawVal.trim()
        else if (key === 'samesite' && rawVal) {
          const v = rawVal.trim().toLowerCase()
          sameSite = v === 'strict' ? 'Strict' : v === 'none' ? 'None' : 'Lax'
        } else if (key === 'max-age' && rawVal) expires = Date.now() / 1000 + Number(rawVal.trim())
        else if (key === 'httponly') httpOnly = true
        else if (key === 'secure') secure = true
      }
      return { name, value, domain: hostname, path, expires, httpOnly, secure, sameSite }
    })
    .filter((c): c is StorageStateCookie => c !== null)
}

// The one place `fetch` is called (system prompt: "data flows through the shared API client ...
// never hand-write response shapes"). Every call is a relative, same-origin path -- proxied to
// `apps/api` in dev (`src/vite.config.ts`), reverse-proxied by Caddy in production (design.md §1) --
// never an absolute cross-origin URL, per this item's handoff ("every shell network request must be
// same-origin"). `credentials: 'include'` on every call so the `devon_sid`/`devon_csrf` cookies
// (design.md §1.7, ADR-003) ride along automatically; nothing here ever reads or writes
// `document.cookie` for the session itself.
import { z } from 'zod'
import {
  adminInstanceSchema,
  instancePublicSchema,
  meSchema,
  problemSchema,
  readyzSchema,
  setupResultSchema,
  type AdminInstance,
  type InstancePublic,
  type Me,
  type Readyz,
} from './api-schemas.js'
import type { Locale } from '@devon/i18n'

const CSRF_HEADER = 'x-csrf-token'
const CSRF_COOKIE = 'devon_csrf'

/**
 * The double-submit companion cookie (HARDENING H1.4). `devon_csrf` is deliberately NOT HttpOnly --
 * `apps/api/src/lib/cookies.ts` sets it that way precisely so this file can echo it back as a header
 * (the session cookie itself is HttpOnly and is never read here, exactly as this file's header says).
 *
 * Read on every mutating call rather than threaded from `useMe()` through each feature: the API now
 * enforces the check globally (`apps/api/src/plugins/csrf-guard.ts`) instead of route by route, and
 * a feature that forgot to pass the token -- as every `features/structure` call did -- must not be
 * the thing that decides whether the request is protected. An explicit `csrfToken` argument still
 * wins, so the one caller that needs a token the cookie cannot yet hold (the reply to `POST
 * /accounts/register` sets the cookie in the same response it is read from) is unchanged.
 */
function csrfHeaders(explicit?: string): Record<string, string> {
  if (explicit) return { [CSRF_HEADER]: explicit }
  const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`).exec(document.cookie)
  const value = match?.[1] ? decodeURIComponent(match[1]) : ''
  return value ? { [CSRF_HEADER]: value } : {}
}

/** Thrown for every non-2xx response. `code` is the RFC 9457 `Problem.code` (design.md §1.5) when
 * the server sent one, else `'internal'`. `requestId` mirrors the `X-Request-Id` response header
 * (design.md §1.7) -- the same reference id `<StateView kind="error">` shows the user, never a raw
 * status code or stack (design.md §8.3). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly requestId: string | null,
    /** `validation_failed` only: the Problem's `errors` list (field path + machine code, never a
     * value) -- what lets a caller tell "that file was infected" from "that file was not an image". */
    public readonly errors: ReadonlyArray<{ path: string; code: string }> = [],
  ) {
    super(`API error ${status} (${code})`)
    this.name = 'ApiError'
  }
}

/** Thrown when `fetch` itself rejects (DNS failure, connection refused, offline) -- distinct from
 * `ApiError` because there is no HTTP response to read a `Problem` or a request id from at all;
 * callers use this to distinguish "the network is down" from "the server said no" (design.md §8.6). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

async function raw(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      credentials: 'include',
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      ...init,
    })
  } catch (cause) {
    throw new NetworkError(cause)
  }
}

async function parseErrorAndThrow(res: Response): Promise<never> {
  const requestId = res.headers.get('x-request-id')
  let code = 'internal'
  let errors: ReadonlyArray<{ path: string; code: string }> = []
  try {
    const body: unknown = await res.json()
    const parsed = problemSchema.safeParse(body)
    if (parsed.success) {
      code = parsed.data.code
      errors = parsed.data.errors ?? []
    }
  } catch {
    // Not a Problem body (e.g. a proxy's own HTML error page) -- fall back to 'internal'.
  }
  throw new ApiError(res.status, code, requestId, errors)
}

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await raw(path, { method: 'GET' })
  if (!res.ok) await parseErrorAndThrow(res)
  return schema.parse(await res.json())
}

/** No feature needed a DELETE call until structure's bo'lim/unit-role removal (EPIC-003) -- added
 * here, next to `get`/`send`, rather than reinventing it per-feature, the same "one place `fetch` is
 * called" reasoning this file's own header states. Two shapes, both real: structure's unit delete
 * replies `200` with a body (`{ deletedAt }`, so the caller can undo it) and takes a response schema
 * (events' comment/claim/photo deletes do the same, with `voidSchema`); work's card-checklist/saved-
 * view deletes always reply `204` and have nothing to parse, so they call this with no schema at all.
 * Overloaded rather than two differently-named methods, so every feature's `api.ts` still reaches this
 * through the one `apiClient.delete` this file's header promises. */
async function del<T>(path: string, schema: z.ZodType<T>, csrfToken?: string): Promise<T>
async function del(path: string, csrfToken?: string): Promise<void>
async function del<T>(
  path: string,
  schemaOrCsrfToken?: z.ZodType<T> | string,
  maybeCsrfToken?: string,
): Promise<T | void> {
  const schema = typeof schemaOrCsrfToken === 'string' ? undefined : schemaOrCsrfToken
  const csrfToken = schema ? maybeCsrfToken : (schemaOrCsrfToken as string | undefined)
  const res = await raw(path, {
    method: 'DELETE',
    headers: csrfHeaders(csrfToken),
  })
  if (!res.ok) await parseErrorAndThrow(res)
  if (!schema) return
  if (res.status === 204) return undefined as T
  return schema.parse(await res.json())
}

async function send<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  schema: z.ZodType<T>,
  csrfToken?: string,
): Promise<T> {
  const res = await raw(path, {
    method,
    headers: { 'content-type': 'application/json', ...csrfHeaders(csrfToken) },
    body: JSON.stringify(body),
  })
  if (!res.ok) await parseErrorAndThrow(res)
  if (res.status === 204) return undefined as T
  return schema.parse(await res.json())
}

/**
 * Raw-bytes upload to a presigned URL (EPIC-001 photo upload: `POST /api/v1/accounts/avatar/upload-url`
 * hands one back). The URL is either same-origin (the API's own local-driver route -- cookies ride
 * along so the token's user is verified against the session) or a MinIO presigned URL on another
 * origin, which must be called WITHOUT credentials: MinIO's default CORS allows `*`, and a browser
 * refuses a credentialed cross-origin request against a wildcard. Deciding by origin keeps the
 * feature code identical for both storage drivers. No JSON, no response schema: a presigned PUT
 * answers with an empty 2xx.
 */
async function uploadFile(
  url: string,
  init: { method: 'PUT'; headers: Record<string, string>; body: Blob },
): Promise<void> {
  const sameOrigin = url.startsWith('/') || url.startsWith(`${window.location.origin}/`)
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      credentials: sameOrigin ? 'include' : 'omit',
    })
  } catch (cause) {
    throw new NetworkError(cause)
  }
  if (!res.ok) await parseErrorAndThrow(res)
}

/**
 * The typed API client helper every `src/features/<name>` module builds its own endpoint functions
 * on (MODULE-GUIDE.md "Web features" / "Typed API client"), instead of hand-rolling `fetch` --
 * same-origin, `credentials: 'include'`, RFC 9457 `Problem` parsing into `ApiError`, and a `zod`
 * schema on every response, exactly like every function below this point already does.
 *
 * ```ts
 * // src/features/people/api.ts
 * import { apiClient } from '../../lib/api-client.js'
 * export const fetchPeople = () => apiClient.get('/api/v1/people', peopleListSchema)
 * ```
 */
export const apiClient = {
  get,
  post: <T>(path: string, body: unknown, schema: z.ZodType<T>, csrfToken?: string) =>
    send(path, 'POST', body, schema, csrfToken),
  patch: <T>(path: string, body: unknown, schema: z.ZodType<T>, csrfToken?: string) =>
    send(path, 'PATCH', body, schema, csrfToken),
  delete: del,
  uploadFile,
}

export function fetchInstance(): Promise<InstancePublic> {
  return get('/api/v1/instance', instancePublicSchema)
}

export function fetchMe(): Promise<Me> {
  return get('/api/v1/me', meSchema)
}

export function patchMe(
  patch: { locale?: Locale; timezone?: string },
  csrfToken: string,
): Promise<Me> {
  return send('/api/v1/me', 'PATCH', patch, meSchema, csrfToken)
}

/** v1.1 SPEC §2.3: the department switcher. The server sets a signed `devon_dept` cookie and answers
 * with the updated `/me`, so the caller can seed the cache before invalidating everything else. */
export function setActiveDepartment(departmentId: string, csrfToken: string): Promise<Me> {
  return send('/api/v1/me/active-department', 'POST', { departmentId }, meSchema, csrfToken)
}

const voidSchema = z.void()

// EPIC-001: a password-only login still returns `204` (parsed as `{ requires2fa: false }` below,
// unchanged behaviour for every account without 2FA enabled); an account with TOTP enabled
// (`modules/accounts/repo.ts`) returns `200 { requires2fa: true, challengeToken }` instead of a
// session -- completed by `verifyTwoFactorLogin` below, exactly like `POST /accounts/2fa/login-verify`
// on the server side.
const loginResultSchema = z.union([
  z.object({ requires2fa: z.literal(true), challengeToken: z.string() }),
  z.object({ requires2fa: z.literal(false) }),
])
export type LoginResult = z.infer<typeof loginResultSchema>

export async function login(credentials: {
  login: string
  password: string
}): Promise<LoginResult> {
  const res = await raw('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  if (!res.ok) await parseErrorAndThrow(res)
  if (res.status === 204) return { requires2fa: false }
  return loginResultSchema.parse(await res.json())
}

export function verifyTwoFactorLogin(input: {
  challengeToken: string
  code: string
}): Promise<void> {
  return send('/api/v1/accounts/2fa/login-verify', 'POST', input, voidSchema)
}

/** `GET /readyz` answers 200 *or* 503 with the identical `{db, valkey, migrations}` body either way
 * (design.md §1.7) -- 503 here is a valid readiness report, not an RFC 9457 `Problem`, so this
 * deliberately does not go through `get()` (which would treat the 503 as an `ApiError` and discard
 * the very flags the admin health card needs to render "Ishlamayapti" against). A transport failure
 * (network down, proxy unreachable) still throws `NetworkError` via `raw()`. */
export async function fetchReadyz(): Promise<Readyz> {
  const res = await raw('/readyz', { method: 'GET' })
  return readyzSchema.parse(await res.json())
}

export function fetchAdminInstance(): Promise<AdminInstance> {
  return get('/api/v1/admin/instance', adminInstanceSchema)
}

export type SetupInput = {
  login: string
  password: string
  givenName: string
  familyName: string
  patronymic?: string
  locale: Locale
}

export function submitSetup(token: string, input: SetupInput) {
  return send(`/api/v1/setup/${encodeURIComponent(token)}`, 'POST', input, setupResultSchema)
}

export function logout(): Promise<void> {
  return send('/api/v1/auth/logout', 'POST', {}, voidSchema)
}

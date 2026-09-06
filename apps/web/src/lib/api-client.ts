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

/** Thrown for every non-2xx response. `code` is the RFC 9457 `Problem.code` (design.md §1.5) when
 * the server sent one, else `'internal'`. `requestId` mirrors the `X-Request-Id` response header
 * (design.md §1.7) -- the same reference id `<StateView kind="error">` shows the user, never a raw
 * status code or stack (design.md §8.3). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly requestId: string | null,
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
  try {
    const body: unknown = await res.json()
    const parsed = problemSchema.safeParse(body)
    if (parsed.success) code = parsed.data.code
  } catch {
    // Not a Problem body (e.g. a proxy's own HTML error page) -- fall back to 'internal'.
  }
  throw new ApiError(res.status, code, requestId)
}

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await raw(path, { method: 'GET' })
  if (!res.ok) await parseErrorAndThrow(res)
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
    headers: {
      'content-type': 'application/json',
      ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) await parseErrorAndThrow(res)
  if (res.status === 204) return undefined as T
  return schema.parse(await res.json())
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

const voidSchema = z.void()

export function login(credentials: { login: string; password: string }): Promise<void> {
  return send('/api/v1/auth/login', 'POST', credentials, voidSchema)
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

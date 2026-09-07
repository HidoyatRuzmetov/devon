// The super admin's "view-as" lens (TECH-SPEC §10, I-8a). `@devon/contracts`'s `Actor.viewAs` and
// `packages/db`'s `app.is_view_as()` RLS predicate have existed since EPIC-000 waiting for exactly this
// (see `apps/api/src/lib/actor.ts`'s "no view-as endpoint exists yet" comment) -- this file is that
// endpoint's supporting machinery: a signed, short-lived cookie carrying `(departmentId, expiresAt)`,
// verified by `plugins/session.ts`'s tiny hook (this module's one, minimal, additive edit to a shared
// file -- see that file's own comment) so every other module's routes see a real `req.actor.viewAs`
// without any of them changing a line.
//
// Deliberately a signed cookie, not a database row: view-as is a *lens*, not data (I-8a says it must
// never survive longer than the super admin chooses, and must vanish the instant they navigate away
// from the console tab if they close it without clicking "Stop"), and every access it enables is
// already independently audited (RLS's `department_child` read policies, and each admin action this
// module performs). HMAC-SHA256 keyed by the existing `CSRF_SECRET` (own purpose-specific `info`
// string via HKDF, same reasoning as `crypto.ts` -- no new `.env` key).
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

export const VIEW_AS_COOKIE_NAME = 'devon_view_as'
export const VIEW_AS_MAX_MINUTES = 30

function macKey(csrfSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', csrfSecret, '', 'devon.admin.view_as_cookie', 32))
}

function mac(departmentId: string, expiresAtMs: number, csrfSecret: string): string {
  return createHmac('sha256', macKey(csrfSecret))
    .update(`${departmentId}.${expiresAtMs}`)
    .digest('hex')
}

/** `expiresAtMs` defaults to `VIEW_AS_MAX_MINUTES` minutes from `now` -- a parameter (not `Date.now()`
 * read internally) so this is pure and unit-testable without faking the clock. */
export function signViewAsCookie(
  departmentId: string,
  csrfSecret: string,
  now: number = Date.now(),
): { value: string; expiresAtMs: number } {
  const expiresAtMs = now + VIEW_AS_MAX_MINUTES * 60_000
  const signature = mac(departmentId, expiresAtMs, csrfSecret)
  return { value: `${departmentId}.${expiresAtMs}.${signature}`, expiresAtMs }
}

/** Returns the department id iff the cookie is well-formed, unexpired (as of `now`), and its
 * signature matches -- `null` for anything else (malformed, tampered, or expired), never throwing:
 * `plugins/session.ts` treats a `null` exactly like "no view-as active", never a 500. */
export function verifyViewAsCookie(
  raw: string | undefined,
  csrfSecret: string,
  now: number = Date.now(),
): string | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [departmentId, expiresAtStr, signature] = parts as [string, string, string]
  const expiresAtMs = Number(expiresAtStr)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return null
  const expected = mac(departmentId, expiresAtMs, csrfSecret)
  const a = Buffer.from(signature, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || a.length === 0) return null
  if (!timingSafeEqual(a, b)) return null
  return departmentId
}

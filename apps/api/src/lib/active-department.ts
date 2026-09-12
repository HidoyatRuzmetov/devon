// The department switcher's server half (v1.1 SPEC §2.3, PERMISSIONS-AUDIT D13).
//
// Until now `actor.departmentId` was "the first membership by `joined_at`" and the client's switcher
// was a localStorage illusion: a user in two departments always *worked* in the first one, so every
// head-vs-member decision for them was made against the wrong department. That is not itself a leak,
// but it makes the rest of the matrix unverifiable, which is worse.
//
// Same shape as `modules/admin/view-as.ts`'s lens cookie and for the same reasons: a signed,
// short-lived value rather than a row, HMAC-SHA256 under an HKDF-separated `info` string off the
// existing `CSRF_SECRET`, so no new `.env` key appears. Two differences that matter:
//
//  - the MAC covers the **user id** as well as the department, so a cookie lifted from one browser
//    cannot select a department in another person's session; and
//  - the value is never trusted on its own. `plugins/session.ts` accepts it only after checking it
//    against `actor.memberships`, so the worst a forged-but-unverifiable cookie can do is fall back
//    to the first membership.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { CookieSerializeOptions } from '@fastify/cookie'

export const ACTIVE_DEPARTMENT_COOKIE_NAME = 'devon_dept'

/** 30 days: the switch is a preference, not a credential -- it survives closing the browser the way
 * "which workspace am I in" does in every product a civil servant already uses (Jakob's Law). The
 * session cookie remains the only thing that authenticates anybody. */
export const ACTIVE_DEPARTMENT_MAX_DAYS = 30

function macKey(csrfSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', csrfSecret, '', 'devon.me.active_department', 32))
}

function mac(userId: string, departmentId: string, expiresAtMs: number, secret: string): string {
  return createHmac('sha256', macKey(secret))
    .update(`${userId}.${departmentId}.${expiresAtMs}`)
    .digest('hex')
}

export function signActiveDepartmentCookie(
  userId: string,
  departmentId: string,
  csrfSecret: string,
  now: number = Date.now(),
): { value: string; expiresAtMs: number } {
  const expiresAtMs = now + ACTIVE_DEPARTMENT_MAX_DAYS * 24 * 60 * 60_000
  const signature = mac(userId, departmentId, expiresAtMs, csrfSecret)
  return { value: `${departmentId}.${expiresAtMs}.${signature}`, expiresAtMs }
}

/** The department id iff the cookie is well-formed, unexpired and signed for **this** user; `null`
 * otherwise, never throwing -- a bad cookie is indistinguishable from no cookie at all. */
export function verifyActiveDepartmentCookie(
  raw: string | undefined,
  userId: string,
  csrfSecret: string,
  now: number = Date.now(),
): string | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [departmentId, expiresAtStr, signature] = parts as [string, string, string]
  const expiresAtMs = Number(expiresAtStr)
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return null
  const expected = mac(userId, departmentId, expiresAtMs, csrfSecret)
  const a = Buffer.from(signature, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || a.length === 0) return null
  if (!timingSafeEqual(a, b)) return null
  return departmentId
}

export function activeDepartmentCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ACTIVE_DEPARTMENT_MAX_DAYS * 24 * 60 * 60,
  }
}

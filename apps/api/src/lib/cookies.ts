// Cookie attribute builders (AC-13, ADR-003). `devon_sid` is HttpOnly so no script can read the
// session bearer token; the CSRF companion cookie is deliberately NOT HttpOnly (the SPA must read it
// to echo it back as a header on state-changing requests -- the standard double-submit pattern this
// item uses instead of `SameSite=Strict`, which ADR-003 rules out for `/join/:key`-style cross-site
// top-level GETs elsewhere in the product).
import type { CookieSerializeOptions } from '@fastify/cookie'

export function sessionCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function expiredSessionCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }
}

export function csrfCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export const CSRF_COOKIE_NAME = 'devon_csrf'
export const CSRF_HEADER_NAME = 'x-csrf-token'

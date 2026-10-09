import { describe, it, expect } from 'vitest'
import { localResponseCookie, localSetCookieHeader } from '../e2e/flow-cookie-options.js'

describe('local cookie transport accommodation', () => {
  const url = 'http://127.0.0.1:48972/api/v1/auth/login'
  it('changes only standalone Secure attributes in single or multiple actual cookie headers', () => {
    expect(
      localSetCookieHeader(
        'sid=Secure; Path=/; Secure; HttpOnly; SameSite=Lax\ncsrf=test; Secure; Max-Age=60',
      ),
    ).toBe('sid=Secure; Path=/; HttpOnly; SameSite=Lax\ncsrf=test; Max-Age=60')
    expect(localSetCookieHeader('sid=test; Secure=value; HttpOnly')).toBe(
      'sid=test; Secure=value; HttpOnly',
    )
  })
  it('preserves actual attributes and opaque values, changing only Secure', () => {
    expect(
      localResponseCookie(
        'sid=opaque=value; Path=/api; Domain=127.0.0.1; HttpOnly; Secure; SameSite=Strict; Max-Age=60',
        url,
        100_000,
      ),
    ).toEqual({
      name: 'sid',
      value: 'opaque=value',
      path: '/api',
      domain: '127.0.0.1',
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
      expires: 160,
    })
  })
  it('preserves expiry and lets Max-Age override it', () => {
    expect(
      localResponseCookie('csrf=test; Expires=Thu, 01 Jan 1970 00:01:00 GMT; SameSite=Lax', url)
        .expires,
    ).toBe(60)
    expect(
      localResponseCookie('sid=; Max-Age=0; Expires=Thu, 01 Jan 2099 00:00:00 GMT', url, 100_000)
        .expires,
    ).toBe(100)
  })
  it.each([
    'https://127.0.0.1:48972/api/v1/auth/login',
    'http://localhost:48972/api/v1/auth/login',
    'http://example.invalid/api/v1/auth/login',
  ])('refuses an unowned origin %s', (origin) => {
    expect(() => localResponseCookie('sid=test; Secure', origin)).toThrow()
  })
  it.each([
    'sid=test; Domain=example.invalid',
    'sid=test; Max-Age=bad',
    'sid=test; Expires=bad',
    'missing-value',
  ])('refuses invalid/foreign attributes %s', (header) => {
    expect(() => localResponseCookie(header, url)).toThrow()
  })
})

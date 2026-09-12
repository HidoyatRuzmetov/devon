// H1.10 (security headers, CORS allow-list, Origin guard) and H1.13 (production errors carry a
// request id and nothing else). Every assertion here is a header the API did not send at all before
// this pass: there was no helmet, no CSP, no HSTS, no frame-ancestors, no referrer policy, no
// permissions policy and no CORS configuration of any kind.
import { describe, it, expect } from 'vitest'
import { buildTestApp, cookieHeader, parseSetCookies } from './test-app.js'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import {
  buildAllowedOrigins,
  isLoopbackOrigin,
  isOriginAllowed,
  originOf,
} from '../../src/plugins/security-headers.js'
import { testConfig } from './test-app.js'

describe('security headers on every response (H1.10)', () => {
  it('sends the full helmet-equivalent set on a public GET', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(res.headers['origin-agent-cluster']).toBe('?1')
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none')
    expect(res.headers['x-dns-prefetch-control']).toBe('off')
    expect(String(res.headers['permissions-policy'])).toContain('camera=()')
    expect(String(res.headers['permissions-policy'])).toContain('geolocation=()')
    await app.close()
  })

  it('sends a CSP that lets an API response load nothing, and cannot be framed', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
    await app.close()
  })

  it('carries the headers on a 401 and on an unmatched route too', async () => {
    const { app } = await buildTestApp()
    const unauthorised = await app.inject({ method: 'GET', url: '/api/v1/me' })
    expect(unauthorised.statusCode).toBe(401)
    expect(unauthorised.headers['x-frame-options']).toBe('DENY')

    const missing = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' })
    expect(missing.statusCode).toBe(404)
    expect(missing.headers['x-content-type-options']).toBe('nosniff')
    await app.close()
  })

  it('does not assert HSTS from a plain-http non-production process', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['strict-transport-security']).toBeUndefined()
    await app.close()
  })

  it('asserts HSTS when NODE_ENV=production', async () => {
    const { app } = await buildTestApp(undefined, { config: { NODE_ENV: 'production' } })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    )
    await app.close()
  })
})

describe('CORS allow-list (H1.10)', () => {
  it('never answers with a wildcard, and never reflects an unknown origin', async () => {
    const { app } = await buildTestApp(undefined, { config: { NODE_ENV: 'production' } })
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['vary']).toBe('origin')
    await app.close()
  })

  it('reflects exactly the configured app origin, with credentials', async () => {
    const { app } = await buildTestApp(undefined, {
      config: { NODE_ENV: 'production', DEVON_PUBLIC_URL: 'https://devon.example.uz' },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://devon.example.uz' },
    })
    expect(res.headers['access-control-allow-origin']).toBe('https://devon.example.uz')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    await app.close()
  })

  it('answers a preflight only for an allow-listed origin', async () => {
    const { app } = await buildTestApp(undefined, {
      config: { NODE_ENV: 'production', DEVON_PUBLIC_URL: 'https://devon.example.uz' },
    })
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me',
      headers: { origin: 'https://devon.example.uz' },
    })
    expect(allowed.statusCode).toBe(204)
    expect(String(allowed.headers['access-control-allow-headers'])).toContain('x-csrf-token')

    const refused = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me',
      headers: { origin: 'https://evil.example' },
    })
    expect(refused.statusCode).toBe(403)
    await app.close()
  })
})

describe('Origin guard on state-changing requests (H1.4 defence in depth)', () => {
  it('refuses a POST carrying a foreign browser Origin, before any handler runs', async () => {
    const { app } = await buildTestApp(undefined, {
      config: { NODE_ENV: 'production', DEVON_PUBLIC_URL: 'https://devon.example.uz' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { login: 'someone', password: 'whatever-example-value' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('forbidden')
    await app.close()
  })

  it('allows a GET carrying a foreign Origin (safe method, CORS already withholds the body)', async () => {
    const { app } = await buildTestApp(undefined, { config: { NODE_ENV: 'production' } })
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

describe('allow-list helpers', () => {
  it('derives the allow-list from DEVON_PUBLIC_URL plus DEVON_ALLOWED_ORIGINS', () => {
    const origins = buildAllowedOrigins(
      testConfig({
        DEVON_PUBLIC_URL: 'https://devon.example.uz/app',
        DEVON_ALLOWED_ORIGINS: 'https://admin.example.uz, https://other.example.uz',
      }),
    )
    expect([...origins].sort()).toEqual([
      'https://admin.example.uz',
      'https://devon.example.uz',
      'https://other.example.uz',
    ])
  })

  it('recognises loopback origins, and admits them only outside production', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:4173')).toBe(true)
    expect(isLoopbackOrigin('https://devon.example.uz')).toBe(false)

    const allowed = new Set(['https://devon.example.uz'])
    expect(isOriginAllowed('http://127.0.0.1:5173', allowed, false)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:5173', allowed, true)).toBe(false)
    expect(isOriginAllowed('https://evil.example', allowed, false)).toBe(false)
  })

  it('returns null for a value that is not a URL', () => {
    expect(originOf('not a url')).toBeNull()
  })
})

describe('error bodies (H1.13, H16.1)', () => {
  it('a validation failure carries a request id, a field path and a machine code -- never the value', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'someone', password: 12345, extraneous: 'not-in-the-schema' },
    })
    expect(res.statusCode).toBe(422)
    const body = res.json()
    expect(body.code).toBe('validation_failed')
    expect(String(body.instance)).toMatch(/^urn:devon:request:/)
    // The path (`/password`) and the machine code are there; the submitted value never is.
    expect(body.errors.some((e: { path: string }) => e.path === '/password')).toBe(true)
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('12345')
    expect(serialized).not.toContain('not-in-the-schema')
    expect(serialized).not.toContain('someone')
    await app.close()
  })

  it('a 500 carries a request id and no stack, SQL or filesystem path', async () => {
    const { app, deps } = await buildTestApp()
    // Force the one seam a unit test can break without a database: the instance lookup behind
    // `GET /api/v1/instance`.
    deps.getInstanceSettings = () => {
      throw new Error('select * from app.instance_settings failed at C:\\src\\repo.ts:42')
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(res.statusCode).toBe(500)
    const serialized = JSON.stringify(res.json())
    expect(res.json().code).toBe('internal')
    expect(String(res.json().instance)).toMatch(/^urn:devon:request:/)
    expect(serialized).not.toContain('select')
    expect(serialized).not.toContain('repo.ts')
    expect(serialized).not.toMatch(/at Object\./)
    await app.close()
  })
})

describe('mass assignment (H1.3)', () => {
  it('a write ignores privileged fields the schema does not name', async () => {
    const state = createFakeState()
    const user = await seedUser(state, { login: 'aziz', password: 'Str0ngExampleValue123' })
    const { app } = await buildTestApp(state)
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'aziz', password: 'Str0ngExampleValue123' },
    })
    const cookies = parseSetCookies(login.headers['set-cookie'])
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: {
        cookie: cookieHeader(cookies),
        'x-csrf-token': cookies['devon_csrf'] as string,
      },
      // `role`, `id` and `status` are not in `patchMeSchema` (which is `.strict()`): the request is
      // refused outright rather than the extra keys being quietly dropped and the rest applied.
      payload: { locale: 'ru', role: 'super_admin', id: 'someone-else', status: 'active' },
    })
    expect(res.statusCode).toBe(422)
    // The actor's role is untouched by the attempt.
    expect(state.users.find((u) => u.id === user.id)?.role).toBe('member')
    await app.close()
  })
})

// H2.1 (compression) / H2.5 (ETag/If-None-Match, Cache-Control) -- app-wide `onSend` behaviour wired
// in `src/app.ts`, exercised here through `app.inject()` (no real socket, so `Content-Encoding`
// still reflects exactly what `@fastify/compress` decided from the injected `accept-encoding`
// header) rather than per-module, since every route gets it for free from `buildApp()`.
import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { buildTestApp } from './test-app.js'

// The full OpenAPI document (`GET /api/v1/openapi.json`) is comfortably over `@fastify/compress`'s
// default 1 KiB threshold -- unlike `/api/v1/instance`'s few-hundred-byte body, which the plugin
// correctly leaves alone (compressing a tiny payload can make it *larger*, per the plugin's own
// default), so it is the right target for asserting compression actually engages.
describe('compression (H2.1)', () => {
  it('compresses a large JSON response with gzip when the client asks for it', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
      headers: { 'accept-encoding': 'gzip' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    const decoded = gunzipSync(res.rawPayload)
    expect(JSON.parse(decoded.toString('utf8'))).toMatchObject({ openapi: expect.any(String) })
    await app.close()
  })

  it('prefers brotli when the client accepts both', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
      headers: { 'accept-encoding': 'gzip, br' },
    })
    expect(res.headers['content-encoding']).toBe('br')
    await app.close()
  })

  it('sends a small response uncompressed (below the size threshold) with no accept-encoding needed', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.json()).toMatchObject({ setupRequired: true })
    await app.close()
  })
})

describe('ETag / If-None-Match (H2.5)', () => {
  it('sends an ETag on a GET and answers a matching If-None-Match with a bare 304', async () => {
    const { app } = await buildTestApp()
    const first = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(first.statusCode).toBe(200)
    const etag = first.headers.etag
    expect(etag).toBeTruthy()

    const second = await app.inject({
      method: 'GET',
      url: '/api/v1/instance',
      headers: { 'if-none-match': String(etag) },
    })
    expect(second.statusCode).toBe(304)
    expect(second.rawPayload.length).toBe(0)
    await app.close()
  })

  it('every authenticated JSON response still carries Cache-Control: private, no-store alongside its ETag', async () => {
    const { app } = await buildTestApp()
    // /healthz opts into no explicit cache-control of its own, so it falls through to the app-wide
    // private/no-store default (src/app.ts) -- ETag registration must not have displaced that hook.
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers.etag).toBeTruthy()
    await app.close()
  })
})

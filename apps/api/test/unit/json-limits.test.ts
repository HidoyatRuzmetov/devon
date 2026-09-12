// H7.4 (limits on request body / JSON depth / AI input length) -- app-wide content-type parser
// behaviour wired in `src/app.ts`, exercised through `app.inject()` against a real, public route
// (`POST /api/v1/auth/login`) so the check is proven to run ahead of auth/permission handling, not
// just as a unit of the parser function in isolation.
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './test-app.js'

function nest(depth: number): unknown {
  let value: unknown = 'leaf'
  for (let i = 0; i < depth; i += 1) value = { next: value }
  return value
}

describe('JSON body depth limit (H7.4)', () => {
  it('accepts a body within the configured depth', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'demo.boshliq', password: 'wrong' },
    })
    // Wrong credentials, but the body itself parsed and reached validation/business logic -- not a
    // depth rejection.
    expect(res.statusCode).not.toBe(422)
    await app.close()
  })

  it('rejects a body nested past JSON_MAX_DEPTH with 422 before it reaches route validation', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'demo.boshliq', password: nest(50) },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'body', code: 'too_deep' }],
    })
    await app.close()
  })

  it('still answers a malformed-JSON body the same way it did before this parser existed', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ not valid json',
    })
    expect(res.statusCode).not.toBe(200)
    await app.close()
  })
})

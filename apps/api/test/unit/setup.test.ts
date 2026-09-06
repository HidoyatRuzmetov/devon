// AC-12: single-use setup URL, race-safe, 410 forever after.
import { describe, expect, it } from 'vitest'
import { createFakeState } from './fake-deps.js'
import { buildTestApp } from './test-app.js'

const VALID_BODY = {
  login: 'super.admin',
  password: 'Str0ngExampleValue123',
  givenName: 'Aziz',
  familyName: 'Yusupov',
  locale: 'uz-Latn',
}

describe('POST /api/v1/setup/{token}', () => {
  it('creates the super admin on first use and returns 201', async () => {
    const state = createFakeState()
    const { app, deps } = await buildTestApp(state)
    const issued = await deps.ensureSetupToken()
    expect(issued).not.toBeNull()

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/setup/${issued!.token}`,
      payload: VALID_BODY,
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.user.role).toBe('super_admin')
    expect(body.user.login).toBe('super.admin')
    expect(body.user.passwordHash).toBeUndefined()
    expect(state.auditEvents.some((e) => e.action === 'setup.completed')).toBe(true)
    await app.close()
  })

  it('returns 410 (never 200) when the same URL is opened again', async () => {
    const state = createFakeState()
    const { app, deps } = await buildTestApp(state)
    const issued = await deps.ensureSetupToken()

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/setup/${issued!.token}`,
      payload: VALID_BODY,
    })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/setup/${issued!.token}`,
      payload: { ...VALID_BODY, login: 'second.admin' },
    })
    expect(second.statusCode).toBe(410)
    expect(second.json().code).toBe('gone')
    expect(state.users).toHaveLength(1) // the second attempt never created a user
    await app.close()
  })

  it('is race-safe: a concurrent loser gets 410, never a second super admin', async () => {
    const state = createFakeState()
    const { app, deps } = await buildTestApp(state)
    const issued = await deps.ensureSetupToken()
    state.forceSetupRaceLoss = true // simulates a second request winning the DB race first

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/setup/${issued!.token}`,
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(410)
    expect(state.users).toHaveLength(0)
    await app.close()
  })

  it('rejects a request from a non-loopback peer with the identical 410 shape, unconsumed', async () => {
    const state = createFakeState()
    const { app, deps } = await buildTestApp(state)
    const issued = await deps.ensureSetupToken()

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/setup/${issued!.token}`,
      payload: VALID_BODY,
      remoteAddress: '203.0.113.5',
    })
    expect(res.statusCode).toBe(410)

    // The token is still valid for a genuine loopback caller afterwards.
    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/setup/${issued!.token}`,
      payload: VALID_BODY,
    })
    expect(retry.statusCode).toBe(201)
    await app.close()
  })

  it('rejects an unknown or garbage token with 410, not a 404 or 500', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/not-a-real-token',
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(410)
    await app.close()
  })

  it('never prints/issues a second token once a super admin exists', async () => {
    const state = createFakeState()
    const { deps } = await buildTestApp(state)
    const first = await deps.ensureSetupToken()
    expect(first).not.toBeNull()
    await deps.consumeSetupToken(first!.token, VALID_BODY, {
      requestId: 'r1',
      userId: null,
      actorRole: null,
      actingForUserId: null,
      ip: '127.0.0.1',
      userAgent: 'test',
    })
    const second = await deps.ensureSetupToken()
    expect(second).toBeNull()
  })
})

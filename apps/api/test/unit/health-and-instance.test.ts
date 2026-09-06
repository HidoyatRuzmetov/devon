import { describe, expect, it } from 'vitest'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { buildTestApp } from './test-app.js'

describe('GET /healthz', () => {
  it('is public and always 200', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})

describe('GET /readyz', () => {
  it('is 200 when the db and migrations checks pass', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ db: true, migrations: true })
  })

  it('is 503 when the db check fails', async () => {
    const state = createFakeState({ dbReady: false })
    const { app } = await buildTestApp(state)
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(503)
    expect(res.json().db).toBe(false)
  })
})

describe('GET /api/v1/instance', () => {
  it('reports setupRequired=true with zero users', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(res.statusCode).toBe(200)
    expect(res.json().setupRequired).toBe(true)
    expect(res.json().locales).toEqual(['uz-Latn', 'uz-Cyrl', 'ru', 'en'])
  })

  // `setupRequired` tracks whether a super admin has ever been bootstrapped, not "any user exists"
  // (H1, found live via a demo instance: `pnpm start --demo` seeds dozens of ordinary `head`/`member`
  // users before the API ever boots, which used to make this always report `false` -- the setup
  // screen read "already used" even with zero super admins and a live, unconsumed token).
  it('still reports setupRequired=true once an ordinary member exists', async () => {
    const state = createFakeState()
    await seedUser(state, { login: 'a', password: 'Str0ngExampleValue123', role: 'member' })
    const { app } = await buildTestApp(state)
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(res.json().setupRequired).toBe(true)
  })

  it('reports setupRequired=false once a super admin exists', async () => {
    const state = createFakeState()
    await seedUser(state, { login: 'a', password: 'Str0ngExampleValue123', role: 'super_admin' })
    const { app } = await buildTestApp(state)
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(res.json().setupRequired).toBe(false)
  })

  it('surfaces instance_settings.is_demo (this item exposes the flag, not the seed)', async () => {
    const state = createFakeState({
      instanceSettings: {
        isDemo: true,
        registrationOpen: true,
        maintenance: { enabled: false, message: null },
      },
    })
    const { app } = await buildTestApp(state)
    const res = await app.inject({ method: 'GET', url: '/api/v1/instance' })
    expect(res.json().isDemo).toBe(true)
  })
})

describe('GET /api/v1/openapi.json', () => {
  it('serves a document describing this item’s endpoints', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.paths['/healthz']).toBeDefined()
    expect(doc.paths['/api/v1/me']).toBeDefined()
  })
})

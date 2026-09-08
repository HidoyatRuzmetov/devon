// H1.9 (progressive lockout, no enumeration) and H11.1 (bounded in-process state).
import { describe, it, expect } from 'vitest'
import { LoginThrottle } from '../../src/lib/login-throttle.js'
import { buildTestApp } from './test-app.js'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'

function clock(start = 1_700_000_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe('LoginThrottle (H1.9)', () => {
  it('lets the first five failures through, then locks', () => {
    const time = clock()
    const throttle = new LoginThrottle(100, time.now)
    const key = LoginThrottle.key('login', 'aziz', '10.0.0.1')

    for (let i = 0; i < 5; i += 1) {
      expect(throttle.check(key).locked).toBe(false)
      throttle.recordFailure(key)
    }
    const decision = throttle.check(key)
    expect(decision.locked).toBe(true)
    if (decision.locked) expect(decision.retryAfterSeconds).toBe(60)
  })

  it('widens the lockout as failures accumulate, and caps it at an hour', () => {
    const time = clock()
    const throttle = new LoginThrottle(100, time.now)
    const key = LoginThrottle.key('login', 'aziz', '10.0.0.1')
    const windows: number[] = []

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const decision = throttle.check(key)
      if (decision.locked) {
        windows.push(decision.retryAfterSeconds)
        time.advance(decision.retryAfterSeconds * 1000 + 1)
        continue
      }
      throttle.recordFailure(key)
    }
    expect(windows.slice(0, 4)).toEqual([60, 300, 900, 3600])
    expect(Math.max(...windows)).toBe(3600)
  })

  it('a successful sign-in clears the counter', () => {
    const time = clock()
    const throttle = new LoginThrottle(100, time.now)
    const key = LoginThrottle.key('login', 'aziz', '10.0.0.1')
    for (let i = 0; i < 4; i += 1) throttle.recordFailure(key)
    throttle.recordSuccess(key)
    for (let i = 0; i < 5; i += 1) {
      expect(throttle.check(key).locked).toBe(false)
      throttle.recordFailure(key)
    }
    expect(throttle.check(key).locked).toBe(true)
  })

  it('keys separately per identity, per IP and per scope (no collateral lockout)', () => {
    const time = clock()
    const throttle = new LoginThrottle(100, time.now)
    const victim = LoginThrottle.key('login', 'aziz', '10.0.0.1')
    const other = LoginThrottle.key('login', 'malika', '10.0.0.1')
    const sameLoginElsewhere = LoginThrottle.key('login', 'aziz', '10.0.0.2')
    const otherScope = LoginThrottle.key('2fa', 'aziz', '10.0.0.1')

    for (let i = 0; i < 6; i += 1) throttle.recordFailure(victim)
    expect(throttle.check(victim).locked).toBe(true)
    expect(throttle.check(other).locked).toBe(false)
    expect(throttle.check(sameLoginElsewhere).locked).toBe(false)
    expect(throttle.check(otherScope).locked).toBe(false)
  })

  it('never keeps the submitted login in clear', () => {
    const key = LoginThrottle.key('login', 'aziz.karimov', '10.0.0.1')
    expect(key).not.toContain('aziz')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stays bounded however many distinct identities are attacked (H11.1)', () => {
    const time = clock()
    const throttle = new LoginThrottle(50, time.now)
    for (let i = 0; i < 5000; i += 1) {
      throttle.recordFailure(LoginThrottle.key('login', `user-${i}`, '10.0.0.1'))
    }
    expect(throttle.size).toBeLessThanOrEqual(50)
  })

  it('forgets a counter after its time-to-live', () => {
    const time = clock()
    const throttle = new LoginThrottle(100, time.now)
    const key = LoginThrottle.key('login', 'aziz', '10.0.0.1')
    for (let i = 0; i < 4; i += 1) throttle.recordFailure(key)
    time.advance(2 * 60 * 60 * 1000)
    expect(throttle.check(key).locked).toBe(false)
    for (let i = 0; i < 5; i += 1) throttle.recordFailure(key)
    expect(throttle.check(key).locked).toBe(true)
  })
})

describe('POST /api/v1/auth/login lockout (H1.9)', () => {
  it('locks after repeated wrong passwords and answers uniformly for an unknown login', async () => {
    const state = createFakeState()
    await seedUser(state, { login: 'aziz', password: 'correct-horse-battery-staple' })
    const { app } = await buildTestApp(state)

    // Distinct source addresses so the per-IP `@fastify/rate-limit` cap (10/minute on this route)
    // never fires first -- what is under test here is the per-identity lockout, not that cap.
    const attempt = (login: string, remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress,
        payload: { login, password: 'definitely-the-wrong-password' },
      })

    for (let i = 0; i < 4; i += 1) {
      const res = await attempt('aziz', '10.1.1.1')
      expect(res.statusCode).toBe(401)
    }
    // The fifth consecutive failure starts the ladder...
    expect((await attempt('aziz', '10.1.1.1')).statusCode).toBe(401)
    const locked = await attempt('aziz', '10.1.1.1')
    expect(locked.statusCode).toBe(429)
    expect(locked.json().code).toBe('rate_limited')
    expect(locked.headers['retry-after']).toBeDefined()

    // A login that does not exist is locked out on the same schedule, with the same body -- so the
    // lockout itself cannot be used to tell a real account from a fictional one (no enumeration).
    for (let i = 0; i < 5; i += 1) {
      const res = await attempt('no-such-person', '10.1.1.2')
      expect(res.statusCode).toBe(401)
    }
    const lockedUnknown = await attempt('no-such-person', '10.1.1.2')
    expect(lockedUnknown.statusCode).toBe(429)
    expect(lockedUnknown.json()).toEqual(locked.json())
    await app.close()
  })
})

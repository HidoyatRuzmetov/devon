import { describe, expect, it } from 'vitest'
import { createFakeState } from './fake-deps.js'
import { seedUser } from './seed.js'
import { buildTestApp } from './test-app.js'

const password = 'StrongExampleValueForEmail123'

describe('email authentication boundary', () => {
  it('authenticates one case-insensitive trimmed email and keeps the ordinary session flow', async () => {
    const state = createFakeState()
    const user = await seedUser(state, {
      login: 'email-user',
      email: 'Account@Example.invalid',
      password,
    })
    const { app } = await buildTestApp(state)
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { login: ' account@example.invalid ', password },
      })
      expect(response.statusCode).toBe(204)
      expect(state.sessions).toHaveLength(1)
      expect(state.sessions[0]!.userId).toBe(user.id)
    } finally {
      await app.close()
    }
  })
  it('refuses ambiguous emails while both usernames continue to authenticate', async () => {
    const state = createFakeState()
    await seedUser(state, { login: 'email-first', email: 'Shared@example.invalid', password })
    await seedUser(state, { login: 'email-second', email: 'shared@EXAMPLE.invalid', password })
    const { app } = await buildTestApp(state)
    try {
      const ambiguous = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { login: 'shared@example.invalid', password },
      })
      expect(ambiguous.statusCode).toBe(401)
      expect(ambiguous.json().code).toBe('unauthenticated')
      expect(state.sessions).toHaveLength(0)
      for (const username of ['email-first', 'email-second']) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/auth/login',
              payload: { login: username, password },
            })
          ).statusCode,
        ).toBe(204)
      }
    } finally {
      await app.close()
    }
  })
  it('wrong, unknown, blank and locked email attempts disclose no account information', async () => {
    const state = createFakeState()
    await seedUser(state, { login: 'email-known', email: 'known@example.invalid', password })
    await seedUser(state, {
      login: 'email-locked',
      email: 'locked@example.invalid',
      password,
      status: 'locked',
    })
    const { app } = await buildTestApp(state)
    try {
      for (const [identifier, attempted] of [
        ['known@example.invalid', 'WrongExamplePassword'],
        ['unknown@example.invalid', password],
        ['   ', password],
        ['locked@example.invalid', password],
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { login: identifier, password: attempted },
        })
        expect(response.statusCode).toBe(401)
        expect(response.json().code).toBe('unauthenticated')
        expect(response.json()).not.toHaveProperty('user')
      }
      expect(state.sessions).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
  it('an exact historical username takes precedence over another account email', async () => {
    const state = createFakeState()
    const exact = await seedUser(state, { login: 'legacy@example.invalid', password })
    await seedUser(state, {
      login: 'alias-owner',
      email: exact.login,
      password: 'OtherStrongExampleValue123',
    })
    const { app } = await buildTestApp(state)
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { login: exact.login, password },
      })
      expect(response.statusCode).toBe(204)
      expect(state.sessions[0]!.userId).toBe(exact.id)
    } finally {
      await app.close()
    }
  })
})

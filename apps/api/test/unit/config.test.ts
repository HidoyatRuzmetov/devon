import { describe, expect, it } from 'vitest'
import { loadConfig, ProductionConfigGuardError } from '../../src/config.js'

const baseEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://real:real-password-value@db.internal:5432/devon', // example, unit test only
  CSRF_SECRET: 'a-real-generated-secret-value-not-the-example-one',
}

describe('loadConfig production boot guard (H7.3, H17.1)', () => {
  it('refuses to start in production with the .env.example CSRF_SECRET placeholder', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        CSRF_SECRET: 'devon_local_dev_csrf_secret_change_in_production', // example value, changeme in production
      }),
    ).toThrow(ProductionConfigGuardError)
  })

  it('refuses to start in production with the .env.example DATABASE_URL placeholder', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        DATABASE_URL: 'postgres://devon_app:devon_local_dev_app@127.0.0.1:55432/devon', // example, local dev only
      }),
    ).toThrow(ProductionConfigGuardError)
  })

  it('names every offending key, not just the first', () => {
    try {
      loadConfig({
        NODE_ENV: 'production',
        CSRF_SECRET: 'devon_local_dev_csrf_secret_change_in_production', // example value, changeme in production
        DATABASE_URL: 'postgres://devon_app:devon_local_dev_app@127.0.0.1:55432/devon', // example, local dev only
      })
      expect.unreachable('loadConfig should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigGuardError)
      expect([...(err as ProductionConfigGuardError).offendingKeys].sort()).toEqual([
        'CSRF_SECRET',
        'DATABASE_URL',
      ])
    }
  })

  it('boots in production with real-looking values', () => {
    const config = loadConfig(baseEnv)
    expect(config.NODE_ENV).toBe('production')
  })

  it('never applies the production guard outside NODE_ENV=production', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://devon_app:devon_local_dev_app@127.0.0.1:55432/devon', // example, local dev only
      CSRF_SECRET: 'devon_local_dev_csrf_secret_change_in_production', // example value, changeme in production
    })
    expect(config.NODE_ENV).toBe('development')
  })

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', CSRF_SECRET: 'x'.repeat(20) })).toThrow()
  })
})

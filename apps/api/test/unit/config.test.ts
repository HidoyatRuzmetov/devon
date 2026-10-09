import { describe, expect, it } from 'vitest'
import {
  loadConfig,
  ProductionConfigGuardError,
  UnscannedUploadsRefusedError,
} from '../../src/config.js'

const baseEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://real:real-password-value@db.internal:5432/devon', // example, unit test only
  CSRF_SECRET: 'a-real-generated-secret-value-not-the-example-one',
  CLAMAV_MODE: 'clamd',
}

describe('loadConfig production boot guard (H7.3, H17.1)', () => {
  it('retains the container bind default and permits literal local QA binding', () => {
    expect(loadConfig(baseEnv).API_HOST).toBe('0.0.0.0')
    expect(loadConfig({ ...baseEnv, API_HOST: '127.0.0.1' }).API_HOST).toBe('127.0.0.1')
    expect(loadConfig({ ...baseEnv, API_HOST: '::1' }).API_HOST).toBe('::1')
    expect(() => loadConfig({ ...baseEnv, API_HOST: 'api.example.org' })).toThrow()
    expect(() => loadConfig({ ...baseEnv, API_HOST: '127.0.0.1.example.org' })).toThrow()
  })
  it('never opts a development server into Telegram polling implicitly', () => {
    expect(loadConfig({ ...baseEnv, NODE_ENV: 'development' }).TELEGRAM_POLLING_ENABLED).toBe(false)
    expect(
      loadConfig({
        ...baseEnv,
        NODE_ENV: 'development',
        TELEGRAM_POLLING_ENABLED: 'true',
      }).TELEGRAM_POLLING_ENABLED,
    ).toBe(true)
    expect(() =>
      loadConfig({
        ...baseEnv,
        NODE_ENV: 'development',
        TELEGRAM_POLLING_ENABLED: 'yes',
      }),
    ).toThrow()
  })
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

  it('refuses to start in production with CLAMAV_MODE=off (TECH-SPEC §6, H1.8)', () => {
    expect(() => loadConfig({ ...baseEnv, CLAMAV_MODE: 'off' })).toThrow(
      UnscannedUploadsRefusedError,
    )
    // The default is 'off' (developer machines), so an unset CLAMAV_MODE is refused too.
    const { CLAMAV_MODE: _omitted, ...withoutClamav } = baseEnv
    expect(() => loadConfig(withoutClamav)).toThrow(UnscannedUploadsRefusedError)
  })

  it('refuses the MinIO placeholder password in production like any other example value', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        STORAGE_DRIVER: 's3',
        STORAGE_S3_ENDPOINT: 'http://minio:9000',
        STORAGE_S3_ACCESS_KEY: 'devon_minio_admin',
        STORAGE_S3_SECRET_KEY: 'devon_local_dev_minio_change_me', // example value: the compose placeholder
      }),
    ).toThrow(ProductionConfigGuardError)
  })

  it('rejects STORAGE_DRIVER=s3 without an endpoint and credentials, in any environment', () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: 'development', STORAGE_DRIVER: 's3' })).toThrow(
      /STORAGE_S3_ENDPOINT/,
    )
  })

  it('reads STORAGE_S3_FORCE_PATH_STYLE=false as false (z.coerce.boolean would say true)', () => {
    const config = loadConfig({
      ...baseEnv,
      STORAGE_S3_FORCE_PATH_STYLE: 'false',
    })
    expect(config.STORAGE_S3_FORCE_PATH_STYLE).toBe(false)
    expect(loadConfig(baseEnv).STORAGE_S3_FORCE_PATH_STYLE).toBe(true)
  })

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', CSRF_SECRET: 'x'.repeat(20) })).toThrow()
  })
})

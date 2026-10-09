import { describe, expect, it } from 'vitest'
import { resolve, relative } from 'node:path'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import {
  assertLocalTestDatabase,
  assertLocalTestUrl,
  localFlowEnvironment,
} from '../e2e/flow-safety.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'sentinel'

function removeOwnedSymlinkFixture(scratch: string, namespace: string): void {
  if (!/^devon_qa_symlink_[a-f0-9]+$/.test(relative(scratch, namespace)))
    throw new Error('Refusing to remove a path outside the owned test fixture')
  rmSync(namespace, { recursive: true, force: true })
}

describe('isolated browser test safety', () => {
  const valid = {
    host: '127.0.0.1',
    database: 'devon_flow_e2e_visual',
    container: 'devon-postgres',
    port: 55432,
  }
  it.each([
    'devon',
    'postgres',
    'production',
    'devon_flow_e2e;drop database devon',
    'devon_qa_prod/x',
  ])('refuses resetting %s', (database) => {
    expect(() => assertLocalTestDatabase({ ...valid, database })).toThrow()
  })
  it.each(['87.192.236.63', 'db.example.org', '127.0.0.1.example.org'])(
    'refuses a remote or disguised host %s',
    (host) => {
      expect(() => assertLocalTestDatabase({ ...valid, host })).toThrow()
    },
  )
  it('accepts only explicit local test names and literal loopback URLs', () => {
    expect(() => assertLocalTestDatabase(valid)).not.toThrow()
    expect(() => assertLocalTestUrl('http://127.0.0.1:48902')).not.toThrow()
    expect(() => assertLocalTestUrl('https://87.192.236.63')).toThrow()
    expect(() => assertLocalTestUrl('file:///tmp/test')).toThrow()
  })
  it('removes inherited external integration credentials and foreign storage', () => {
    const env = localFlowEnvironment(
      {
        AI_API_KEY: qaExampleCredential1,
        TELEGRAM_BOT_TOKEN: qaExampleCredential1,
        SMTP_PASSWORD: qaExampleCredential1,
        STORAGE_S3_ENDPOINT: 'https://example.org',
        CENTRIFUGO_API_URL: 'https://example.org',
        VAPID_PRIVATE_KEY: 'sentinel',
        DEVON_SENTINEL_URL: 'http://127.0.0.1:8787',
        NODE_OPTIONS: '--import=unrelated-preload',
        PATH: 'keep',
      },
      { API_PORT: '48901' },
      resolve(import.meta.dirname, '../e2e/.tmp/devon_flow_e2e_test/storage'),
    )
    expect(env).toMatchObject({
      AI_API_KEY: '',
      TELEGRAM_BOT_TOKEN: undefined,
      TELEGRAM_POLLING_ENABLED: 'false',
      STORAGE_DRIVER: 'local',
      PATH: 'keep',
    })
    expect(env['SMTP_PASSWORD']).toBeUndefined()
    expect(env['STORAGE_S3_ENDPOINT']).toBeUndefined()
    expect(env['CENTRIFUGO_API_URL']).toBeUndefined()
    expect(env['VAPID_PRIVATE_KEY']).toBeUndefined()
    expect(env['DEVON_SENTINEL_URL']).toBeUndefined()
    expect(env['NODE_OPTIONS']).toBeUndefined()
  })
  it('bounds the real API and seed pool even when inherited sizing or overrides are larger', () => {
    const env = localFlowEnvironment(
      { DB_POOL_MAX: '100', DB_POOL_MIN: '20', QUEUE_DB_POOL_MAX: '100' },
      { DB_POOL_MAX: '50', DB_POOL_MIN: '10', QUEUE_DB_POOL_MAX: '50' },
      resolve(import.meta.dirname, '../e2e/.tmp/devon_flow_e2e_test/storage'),
    )
    expect(env['DB_POOL_MAX']).toBe('6')
    expect(env['DB_POOL_MIN']).toBe('1')
    expect(env['QUEUE_DB_POOL_MAX']).toBe('2')
  })
  it.each([
    '../flow_e2e_production/storage',
    './.tmp/devon_flow_e2e_test/../../foreign_flow_e2e/storage',
    './.tmp/devon/storage',
    './.tmp/devon_flow_e2e_test/storage-named-incorrectly',
  ])('refuses storage outside the dedicated namespace: %s', (candidate) => {
    expect(() =>
      localFlowEnvironment({}, {}, resolve(import.meta.dirname, '../e2e', candidate)),
    ).toThrow()
  })
  it.each([true, false])(
    'refuses existing/dangling storage junction (target exists=%s)',
    (exists) => {
      const scratch = resolve(import.meta.dirname, '../e2e/.tmp')
      const namespace = resolve(scratch, `devon_qa_symlink_${randomBytes(4).toString('hex')}`)
      const target = resolve(namespace, 'other-directory')
      const storage = resolve(namespace, 'storage')
      mkdirSync(exists ? target : namespace, { recursive: true })
      try {
        expect(() => localFlowEnvironment({}, {}, storage)).not.toThrow()
        symlinkSync(target, storage, process.platform === 'win32' ? 'junction' : 'dir')
        expect(() => localFlowEnvironment({}, {}, storage)).toThrow(
          'symlinks or directory junctions',
        )
      } finally {
        removeOwnedSymlinkFixture(scratch, namespace)
      }
    },
  )
})

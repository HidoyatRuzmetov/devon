import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { queueDatabaseOptions } from '../../src/lib/queue-database.js'

const exampleConnectionString = 'postgres://example:example@127.0.0.1:55432/devon_qa_queue'
const exampleEnv = { DATABASE_URL: exampleConnectionString, CSRF_SECRET: 'Example-only secret' }

describe('validated PgBoss pool sizing', () => {
  it('retains the existing production pool maximum and passes the connection string intact', () => {
    expect(queueDatabaseOptions(exampleConnectionString, {})).toEqual({
      connectionString: exampleConnectionString,
      max: 10,
    })
    expect(loadConfig(exampleEnv).QUEUE_DB_POOL_MAX).toBe(10)
  })
  it('passes the guarded QA pool bound to PgBoss without altering worker or database options', () => {
    expect(queueDatabaseOptions(exampleConnectionString, { QUEUE_DB_POOL_MAX: '2' })).toEqual({
      connectionString: exampleConnectionString,
      max: 2,
    })
    expect(loadConfig({ ...exampleEnv, QUEUE_DB_POOL_MAX: '2' }).QUEUE_DB_POOL_MAX).toBe(2)
  })
  it.each(['0', '-1', '1.5', 'NaN', '101', ''])('fails startup and worker sizing for %s', (max) => {
    expect(() =>
      queueDatabaseOptions(exampleConnectionString, { QUEUE_DB_POOL_MAX: max }),
    ).toThrow()
    expect(() => loadConfig({ ...exampleEnv, QUEUE_DB_POOL_MAX: max })).toThrow()
  })
})

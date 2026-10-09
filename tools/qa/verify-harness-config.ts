import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadConfig } from '../../apps/api/src/config.js'
import { loadAiConfig } from '../../packages/ai/src/config.js'
import { localFlowEnvironment } from '../../apps/web/test/e2e/flow-safety.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'synthetic-inherited-sentinel'
const exampleUrl = 'postgres://app_devon_flow_e2e:synthetic@127.0.0.1:55432/devon_flow_e2e'
const qaExampleCredential3 = 'synthetic-local-test-config-only'

const env = localFlowEnvironment(
  {
    TELEGRAM_BOT_TOKEN: qaExampleCredential1,
    TELEGRAM_BOT_USERNAME: 'synthetic-inherited-sentinel',
    AI_API_KEY: qaExampleCredential1,
  },
  {
    DATABASE_URL: exampleUrl,
    CSRF_SECRET: qaExampleCredential3,
    NODE_ENV: 'development',
  },
  resolve('apps/web/test/e2e/.tmp/devon_flow_e2e_config/storage'),
)
const config = loadConfig(env)
assert.equal(config.TELEGRAM_BOT_TOKEN, undefined)
assert.equal(config.TELEGRAM_BOT_USERNAME, undefined)
assert.equal(config.TELEGRAM_POLLING_ENABLED, false)
assert.equal(config.STORAGE_DRIVER, 'local')
assert.equal(loadAiConfig(env).apiKey, null)
console.log('PASS actual API/AI config parsing: no live integration credentials')

import { defineConfig } from '@playwright/test'
import base from './platform-qa.config.js'
import { FLOW_API_PORT, FLOW_DB_NAME, FLOW_WEB_PORT } from './flow-env.js'

if (
  FLOW_DB_NAME !== 'devon_flow_e2e_worker' ||
  FLOW_API_PORT !== 48971 ||
  FLOW_WEB_PORT !== 48972 ||
  process.env['FLOW_CENTRIFUGO_PORT'] !== '48973' ||
  process.env['FLOW_REALTIME'] !== '1' ||
  process.env['FLOW_SEED_DEMO'] !== '1'
)
  throw new Error(
    'Work worker proof requires its exact reserved local database, ports and services',
  )

export default defineConfig({
  ...base,
  testMatch: /platform-work-workers\.qa\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
})

import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import base from './playwright.config.js'

if (process.env['FLOW_PRODUCTION_BUILD'] !== '1')
  throw new Error('Production loading QA requires a genuine built preview')
if (!base.webServer || Array.isArray(base.webServer))
  throw new Error('Production loading QA requires one owned local web server')
const root = resolve(import.meta.dirname, '../../../..')
const build = JSON.parse(
  readFileSync(resolve(root, 'tools/perf/lighthouse/out/production-build.json'), 'utf8'),
)
if (!build.stable || build.forcedStateBuildFlag !== false)
  throw new Error('Production loading QA requires a verified stable production build receipt')

export default defineConfig({
  ...base,
  testMatch: /production-loading\.qa\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  outputDir: resolve(root, 'artifacts/qa/2026-10/results/production-loading'),
  reporter: [
    ['list'],
    ['json', { outputFile: resolve(root, 'artifacts/qa/2026-10/production-loading-results.json') }],
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    ...base.webServer,
    command: 'pnpm --filter @devon/web preview --mode test',
    env: { ...base.webServer.env, DEVON_E2E: '0' },
    reuseExistingServer: false,
  },
})

import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

if (process.env['FLOW_REALTIME'] !== '1')
  throw new Error('Realtime QA requires FLOW_REALTIME=1 and its owned local broker')
if (!base.webServer || Array.isArray(base.webServer))
  throw new Error('Realtime QA requires one owned local web server')
const built = process.env['FLOW_PRODUCTION_BUILD'] === '1'

export default defineConfig({
  ...base,
  testMatch: /realtime-.*\.qa\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  outputDir: resolve(
    import.meta.dirname,
    `../../../../artifacts/qa/2026-10/results/realtime${built ? '-production-build' : ''}`,
  ),
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `../../../../artifacts/qa/2026-10/realtime${built ? '-production-build' : ''}-results.json`,
      },
    ],
  ],
  use: { ...base.use, screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    ...base.webServer,
    ...(built ? { command: 'pnpm --filter @devon/web preview --mode test' } : {}),
    reuseExistingServer: false,
  },
})

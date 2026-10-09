import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: /period-timer-boundary\.qa\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  outputDir: resolve(import.meta.dirname, '../../../../artifacts/qa/2026-10/results/period-timer'),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/period-timer-results.json' }],
  ],
  use: { ...base.use, screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})

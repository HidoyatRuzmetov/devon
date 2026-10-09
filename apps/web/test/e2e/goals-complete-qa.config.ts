import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: ['goals.qa.spec.ts', 'goals-visual.qa.spec.ts'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/goals-complete',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/goals-complete-results.json' }],
  ],
  use: { ...base.use, screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})

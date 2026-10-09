import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: 'events-nested-visual.qa.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/events-nested-visual',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/events-nested-visual-results.json' }],
  ],
  use: { ...base.use, screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})

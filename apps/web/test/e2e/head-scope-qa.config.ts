import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: 'head-scope.qa.spec.ts',
  grepInvert: /@head-visual/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  outputDir: resolve(import.meta.dirname, '../../../../artifacts/qa/2026-10/results/head-scope'),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/head-scope-results.json' }],
  ],
  use: { ...base.use, screenshot: 'only-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
})

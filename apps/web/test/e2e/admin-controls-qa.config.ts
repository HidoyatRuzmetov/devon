import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'
export default defineConfig({
  ...base,
  testMatch: 'admin-controls.qa.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/admin-controls',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/admin-controls-results.json' }],
  ],
  use: { ...base.use, screenshot: 'only-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
})

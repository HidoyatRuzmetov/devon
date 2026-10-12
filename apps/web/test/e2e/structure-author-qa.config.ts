import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

const run = process.env['STRUCTURE_QA_RUN'] ?? 'development-before'
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid Structure evidence run name')

export default defineConfig({
  ...base,
  testMatch: 'structure-author.qa.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  outputDir: resolve(import.meta.dirname, '../../../../artifacts/qa/2026-10/structure-author', run),
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: `../../../../artifacts/qa/2026-10/structure-author/${run}/results.json` },
    ],
  ],
  use: {
    ...base.use,
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
})

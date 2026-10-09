import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

if (process.env['FLOW_REALTIME'] !== '1')
  throw new Error('Management QA requires the owned local broker')
export default defineConfig({
  ...base,
  testMatch: 'management-controls.qa.spec.ts',
  outputDir: resolve(import.meta.dirname, '../../../../artifacts/qa/2026-10/results/management'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/management-results.json' }],
  ],
  use: { ...base.use, screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})

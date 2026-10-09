import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: ['canvas-controls.qa.spec.ts', 'platform-personal-canvas.qa.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: join(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/canvas-nested',
    process.env['QA_RUN_ID'] ?? 'default',
  ),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: [
    'visual-controls.flow.spec.ts',
    'people-controls.flow.spec.ts',
    'badge-contrast.flow.spec.ts',
    'card-readability.flow.spec.ts',
    'avatar-readability.flow.spec.ts',
  ],
  workers: 1,
  outputDir: join(import.meta.dirname, '../../../../artifacts/qa/2026-10/results/visual-controls'),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

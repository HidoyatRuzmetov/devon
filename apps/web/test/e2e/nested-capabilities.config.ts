import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  testMatch: [
    'people-large.flow.spec.ts',
    'project-gallery.flow.spec.ts',
    'project-capabilities.flow.spec.ts',
    'group-project.flow.spec.ts',
    'structure.flow.spec.ts',
    'structure-readability.flow.spec.ts',
    'dialog-scroll.flow.spec.ts',
  ],
  workers: 1,
  outputDir: join(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/visual-capabilities',
  ),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

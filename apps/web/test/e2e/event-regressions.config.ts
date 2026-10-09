import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from './playwright.config.js'

export default defineConfig({
  ...base,
  outputDir: fileURLToPath(
    new URL('../../../../artifacts/qa/2026-10/results/events/', import.meta.url),
  ),
  testMatch: ['event-wizard-rsvp.flow.spec.ts', 'event-carpool-poll.flow.spec.ts'],
  retries: 0,
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

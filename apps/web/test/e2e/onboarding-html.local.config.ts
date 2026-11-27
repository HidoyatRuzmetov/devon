import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: ['onboarding-html.local.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: '../../../../artifacts/qa/viewer-v2/onboarding-test',
  use: {
    ...devices['Desktop Chrome'],
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
  },
})

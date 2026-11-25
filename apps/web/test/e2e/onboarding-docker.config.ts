import { defineConfig, devices } from '@playwright/test'

// Dedicated, loopback-only stack started by scripts/onboarding-docker-review.mjs.
process.env['FLOW_API_PORT'] = '48941'
process.env['FLOW_WEB_PORT'] = '48942'
process.env['FLOW_DB_NAME'] = 'devon_qa_onboarding_docker'

export default defineConfig({
  testDir: '.',
  testMatch: ['onboarding.docker.spec.ts', 'public-dashboard.docker.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: './onboarding-docker-setup.ts',
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../../../artifacts/qa/onboarding/docker-report',
        open: 'never',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:48942',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: 'docker-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
})

import { defineConfig, devices } from '@playwright/test'

// Dedicated, loopback-only stack started by scripts/multiple-heads-docker-review.mjs.
process.env['FLOW_API_PORT'] = '48931'
process.env['FLOW_WEB_PORT'] = '48932'
process.env['FLOW_DB_NAME'] = 'devon_qa_heads_docker'

export default defineConfig({
  testDir: '.',
  testMatch: ['multi-head-workflow.flow.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: './multi-head-docker-setup.ts',
  reporter: [
    ['list'],
    [
      'html',
      { outputFolder: '../../../../artifacts/qa/multiple-heads/docker-report', open: 'never' },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:48932',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    {
      name: 'docker-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
})

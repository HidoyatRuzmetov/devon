import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

const runId = process.env['QA_RUN_ID'] ?? 'default'
if (!/^[a-z][a-z0-9-]{0,63}$/.test(runId)) {
  throw new Error('QA_RUN_ID must be a short lowercase name without path separators')
}
const results = resolve(
  import.meta.dirname,
  '../../../../artifacts/qa/2026-10/results/platform',
  runId,
)
const webServer = base.webServer
if (!webServer || Array.isArray(webServer)) {
  throw new Error('The platform QA fixture requires its single owned local web server')
}

export default defineConfig({
  ...base,
  // Geometry checks intentionally inspect the designed recovery blocks. This flag only enables
  // the existing test-mode URL selector; ordinary API faults still require actual fault evidence.
  webServer: {
    ...webServer,
    env: { ...webServer.env, DEVON_E2E: process.env['FLOW_PRODUCTION_BUILD'] === '1' ? '0' : '1' },
  },
  testMatch: /platform-.*\.qa\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  outputDir: results,
  retries: 0,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: resolve(results, 'summary.json'),
      },
    ],
  ],
  use: { ...base.use, screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})

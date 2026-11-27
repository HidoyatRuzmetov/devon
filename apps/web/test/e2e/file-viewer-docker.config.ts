import { defineConfig } from '@playwright/test'
import base from './onboarding-docker.config.js'

process.env['FLOW_DB_CONTAINER'] = 'devon-onboarding-review-postgres-1'

export default defineConfig(base, {
  testMatch: [
    'file-viewer.docker.spec.ts',
    'introduction-privacy.docker.spec.ts',
    'file-viewer-proxy.docker.spec.ts',
    'page-discussion.flow.spec.ts',
  ],
  timeout: 180_000,
  outputDir: '../../../../artifacts/qa/file-viewer/playwright-results',
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '../../../../artifacts/qa/file-viewer/report',
        open: 'never',
      },
    ],
  ],
})

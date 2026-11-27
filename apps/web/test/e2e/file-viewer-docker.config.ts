import { defineConfig } from '@playwright/test'
import base from './onboarding-docker.config.js'

export default defineConfig(base, {
  testMatch: ['file-viewer.docker.spec.ts', 'introduction-privacy.docker.spec.ts'],
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

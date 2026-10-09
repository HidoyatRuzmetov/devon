import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './production-loading-qa.config.js'

const root = resolve(import.meta.dirname, '../../../..')
export default defineConfig({
  ...base,
  testMatch: /production-entity-loading\.qa\.spec\.ts/,
  outputDir: resolve(root, 'artifacts/qa/2026-10/results/production-entity-loading'),
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: resolve(root, 'artifacts/qa/2026-10/production-entity-loading-results.json') },
    ],
  ],
})

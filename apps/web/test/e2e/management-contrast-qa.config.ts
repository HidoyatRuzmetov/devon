import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './management-qa.config.js'

export default defineConfig({
  ...base,
  testMatch: 'platform-routes.qa.spec.ts',
  grep: /full inventory route baseline: head/,
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/management-contrast',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/management-contrast-results.json' }],
  ],
})

import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './events-nested-qa.config.js'

export default defineConfig({
  ...base,
  testMatch: 'events-pointer.qa.spec.ts',
  timeout: 60_000,
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/events-pointer',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/events-pointer-results.json' }],
  ],
})

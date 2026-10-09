import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './events-nested-visual-qa.config.js'

export default defineConfig({
  ...base,
  testMatch: ['events-boundaries.qa.spec.ts', 'events-nested-visual.qa.spec.ts'],
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/events-readability',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/events-readability-results.json' }],
  ],
})

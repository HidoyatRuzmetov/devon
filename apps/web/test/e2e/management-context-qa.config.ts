import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './management-qa.config.js'

export default defineConfig({
  ...base,
  grep: /admin analytics guidance/,
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/management-context',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/management-context-results.json' }],
  ],
})

import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './head-scope-qa.config.js'

const visualBase = { ...base }
delete visualBase.grepInvert

export default defineConfig({
  ...visualBase,
  grep: /@head-visual/,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/head-scope-visual',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/head-scope-visual-results.json' }],
  ],
})

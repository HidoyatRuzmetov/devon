import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

const run = process.env['BOARD_NAV_QA_RUN'] ?? 'development'
if (!/^[a-z0-9-]+$/.test(run)) throw new Error('Invalid board navigation run name')
const output = resolve(
  import.meta.dirname,
  '../../../../artifacts/qa/2026-10/board-navigation',
  run,
)

export default defineConfig({
  ...base,
  testMatch: 'board-navigation.qa.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  outputDir: output,
  reporter: [['list'], ['json', { outputFile: resolve(output, 'results.json') }]],
  use: { ...base.use, screenshot: 'only-on-failure', actionTimeout: 15_000 },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
})

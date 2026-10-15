import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config.js'

const output = resolve(import.meta.dirname, '../../../../artifacts/qa/2026-10/avatar-interactions')

export default defineConfig({
  ...base,
  testMatch: 'avatar-interactions.qa.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 150_000,
  outputDir: output,
  reporter: [['list'], ['json', { outputFile: resolve(output, 'results.json') }]],
  use: { ...base.use, screenshot: 'only-on-failure', actionTimeout: 15_000 },
})

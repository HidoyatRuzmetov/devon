import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './platform-qa.config.js'

if (process.env['FLOW_CLAMAV'] !== '1')
  throw new Error('Real upload scanning requires FLOW_CLAMAV=1')
const run = process.env['QA_RUN_ID'] ?? 'scanner'
export default defineConfig({
  ...base,
  testMatch: /scanner-upload\.qa\.spec\.ts/,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: resolve(
          import.meta.dirname,
          '../../../../artifacts/qa/2026-10/scanner',
          `${run}-results.json`,
        ),
      },
    ],
  ],
})

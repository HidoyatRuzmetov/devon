import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'

// Explicit visual-review fixture. Ordinary flows still exercise the provider-unavailable fallback.
process.env['FLOW_BIRTHDAY_FIXTURE'] = '1'
export default defineConfig(base, {
  testMatch: ['**/birthday-celebration.flow.spec.ts'],
  workers: 1,
})

import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'

// Explicit fixture suite: the ordinary browser suite still proves the missing-provider state.
process.env['FLOW_AI_ACTION_FIXTURE'] = '1'
export default defineConfig(base, { testMatch: ['**/ai-actions.qa.spec.ts'], workers: 1 })

import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './events-nested-qa.config.js'

const functional = [
  'events-nested.qa.spec.ts',
  'events-boundaries.qa.spec.ts',
  'events-pointer.qa.spec.ts',
]

export default defineConfig({
  ...base,
  timeout: 180_000,
  testMatch: [...functional, 'events-nested-visual.qa.spec.ts'],
  outputDir: resolve(
    import.meta.dirname,
    '../../../../artifacts/qa/2026-10/results/events-complete',
  ),
  reporter: [
    ['list'],
    ['json', { outputFile: '../../../../artifacts/qa/2026-10/events-complete-results.json' }],
  ],
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    testMatch:
      name === 'chromium' ? [...functional, 'events-nested-visual.qa.spec.ts'] : functional,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
})

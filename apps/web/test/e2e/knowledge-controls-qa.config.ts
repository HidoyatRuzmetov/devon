import { defineConfig } from '@playwright/test'
import base from './platform-qa.config.js'

export default defineConfig({
  ...base,
  testMatch: /knowledge-(?:controls|visual)\.qa\.spec\.ts/,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: /knowledge-visual/ },
    { name: 'webkit', use: { browserName: 'webkit' }, testIgnore: /knowledge-visual/ },
  ],
})

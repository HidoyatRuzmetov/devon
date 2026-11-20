import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default defineConfig({
  testDir: '.',
  testMatch: 'multi-head-preview.qa.spec.ts',
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:48932',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
  outputDir: '../../../../artifacts/qa/multiple-heads/ui-test-results',
  webServer: {
    cwd: resolve(import.meta.dirname, '../..'),
    command: `node "${resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js')}" --config src/vite.config.ts --host 127.0.0.1 --port 48932`,
    url: 'http://127.0.0.1:48932',
    reuseExistingServer: false,
    timeout: 90_000,
  },
})

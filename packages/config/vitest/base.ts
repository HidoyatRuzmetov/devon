// Shared Vitest config. `agentic/gates.json` sets `limits.coverage_lines_min = 70`; every package's
// own vitest.config.ts should spread this in and add its own `test.environment` / `test.setupFiles`.
//
//   import { mergeConfig, defineConfig } from 'vitest/config'
//   import base from '@devon/config/vitest/base'
//   export default mergeConfig(base, defineConfig({ test: { environment: 'jsdom' } }))
import { defineConfig } from 'vitest/config'

const COVERAGE_LINES_MIN = 70

export default defineConfig({
  test: {
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['**/dist/**', '**/*.config.*', '**/test/**', '**/*.d.ts'],
      thresholds: {
        lines: COVERAGE_LINES_MIN,
      },
    },
  },
})

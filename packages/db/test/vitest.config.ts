import { mergeConfig, defineConfig } from 'vitest/config'
import base from '../../config/vitest/base.ts'

// `test:unit` (the `unit` gate) never touches Docker or a real database: only `test/unit/**` runs
// here. The Testcontainers-backed suites live in `test/integration/**` and run via `migrate:verify`
// (see `test/vitest.integration.config.ts`) -- keeping the fast gate fast and Docker-independent.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/unit/**/*.test.ts'],
      environment: 'node',
      coverage: {
        include: ['src/**/*.ts'],
      },
    },
  }),
)

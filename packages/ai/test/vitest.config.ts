import { mergeConfig, defineConfig } from 'vitest/config'
import base from '../../config/vitest/base.ts'

// The whole gateway is pure/unit-testable without a network: `provider.ts`'s `MockProvider` stands in
// for the real GLM endpoint (same reasoning `apps/api/test/vitest.config.ts` gives for its injected
// `Deps` fake) -- nothing in this package's `unit` gate ever makes an outbound HTTP call.
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

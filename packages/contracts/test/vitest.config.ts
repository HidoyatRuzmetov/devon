import { mergeConfig, defineConfig } from 'vitest/config'
import base from '../../config/vitest/base.ts'

// `test:unit` (the `unit` gate) covers everything in this package. Plain Node logic throughout --
// `can()`, `problem()` and the field-tier helpers touch neither the DOM nor a database.
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

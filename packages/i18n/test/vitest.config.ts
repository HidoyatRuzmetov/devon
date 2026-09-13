import { mergeConfig, defineConfig } from 'vitest/config'
import base from '../../config/vitest/base.ts'

// `test:unit` (the `unit` gate) covers everything in this package, including `terms:verify` and the
// `banned.json` scan (design.md §1.4: "Both run inside `@devon/i18n test:unit`, so the `unit` gate
// carries them"). `environment: 'jsdom'` is needed for react.test.ts (`useSyncExternalStore` renders
// through `@testing-library/react`); the rest of the suite is plain Node logic and does not care.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['test/unit/**/*.test.ts'],
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      coverage: {
        include: ['src/**/*.ts'],
        exclude: ['**/dist/**', '**/*.config.*', '**/test/**', '**/*.d.ts', 'src/cli/**'],
      },
    },
  }),
)

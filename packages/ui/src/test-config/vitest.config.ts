import { mergeConfig, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import base from '../../../config/vitest/base.ts'

// Lives under `src/` (not a package-root `test/`) so it stays inside this item's `TOUCHES`
// (`packages/ui/src/**`); `package.json`'s `test:unit` script points at this file explicitly with
// `--config`, which works from any location. Covers every primitive, state component and shell
// pattern in this package -- jsdom throughout, there is no plain-Node logic module here the way
// @devon/i18n has one.
export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      // Left unset deliberately: Vitest's default `root` is `process.cwd()`, which is already
      // `packages/ui` when this config runs via the package's own `test:unit` script (or via
      // `pnpm --filter @devon/ui ...`) -- not the directory of this config file two levels down.
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./src/test-config/setup.ts'],
      css: false,
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          '**/dist/**',
          '**/*.config.*',
          '**/*.d.ts',
          'src/lint/**',
          'src/test-config/**',
          'src/**/*.stories.tsx',
          'src/**/*.test.{ts,tsx}',
          'src/index.ts',
        ],
      },
    },
  }),
)

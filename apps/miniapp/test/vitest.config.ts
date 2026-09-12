import { mergeConfig, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import base from '../../../packages/config/vitest/base.ts'

// `test:unit` runs with cwd = `apps/miniapp` (pnpm sets cwd to the package directory), so `include`
// below is relative to that, not to this file's own directory (same reasoning as `apps/web`'s).
export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      include: ['test/unit/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      css: false,
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['**/dist/**', '**/*.config.*', '**/*.d.ts', 'src/main.tsx'],
      },
    },
  }),
)

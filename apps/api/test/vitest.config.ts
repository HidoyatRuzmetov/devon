import { mergeConfig, defineConfig } from 'vitest/config'
import base from '../../../packages/config/vitest/base.ts'

// The `unit` gate never touches Postgres: every handler in this package is built against an injected
// `Deps` bag (see `src/deps.ts`), so route/permission/session-lifecycle behaviour is exercised here
// with an in-memory fake, and the real Postgres-backed implementation is proved separately by the
// `setup:prove` / `session:prove` / `admin:prove` scripts (design.md §9) against a real database.
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

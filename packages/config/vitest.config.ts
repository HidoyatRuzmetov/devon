import { defineConfig } from 'vitest/config'

// @devon/config ships presets, not application code -- there is no `src/` to hold a coverage
// threshold against. The one thing under test here (workspace-scripts.test.ts) is itself the
// AC-14 non-vacuity backstop; it is exercised directly rather than measured for coverage.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
